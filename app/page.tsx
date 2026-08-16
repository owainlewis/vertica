"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Download,
  ImagePlus,
  Layers3,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { ChangeEvent, CSSProperties, useMemo, useState } from "react";
import {
  aiPrompt,
  CarouselConfig,
  CarouselSlide,
  generateCarouselFromText,
  parseCarouselConfig,
  starterConfig,
  TemplateId,
} from "./carousel";

type Notice = { kind: "success" | "error"; message: string } | null;

function Slide({
  slide,
  config,
  index,
  exportMode = false,
}: {
  slide: CarouselSlide;
  config: CarouselConfig;
  index: number;
  exportMode?: boolean;
}) {
  const style = slide.background
    ? ({ "--slide-background": `url(${slide.background})` } as CSSProperties)
    : undefined;

  return (
    <article
      className={`carousel-slide template-${config.template} layout-${slide.layout} ${slide.title.length > 45 ? "long-title" : ""} ${slide.title.length > 70 ? "dense-title" : ""} ${slide.body.length > 140 ? "long-body" : ""} ${slide.body.length > 230 ? "dense-body" : ""} ${exportMode ? "export-slide" : ""}`}
      style={style}
      data-export-slide={exportMode ? "true" : undefined}
    >
      <div className="slide-image" />
      <div className="slide-overlay" />
      <div className="slide-texture" />
      <div className="slide-content">
        {slide.kicker && <span className="slide-kicker">{slide.kicker}</span>}
        {slide.layout === "quote" && <span className="quote-mark">“</span>}
        <h2>{slide.title}</h2>
        {slide.body && <p>{slide.body}</p>}
      </div>
      <footer className="slide-meta">
        <span>{config.author}</span>
        <span>{String(index + 1).padStart(2, "0")} / {String(config.slides.length).padStart(2, "0")}</span>
      </footer>
    </article>
  );
}

function readImages(files: FileList) {
  return Promise.all(
    Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
            reader.readAsDataURL(file);
          }),
      ),
  );
}

export default function Home() {
  const [config, setConfig] = useState<CarouselConfig>(starterConfig);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<"content" | "design">("content");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"text" | "json">("text");
  const [sourceText, setSourceText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [backgrounds, setBackgrounds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [exporting, setExporting] = useState(false);

  const selectedSlide = config.slides[selectedIndex] ?? config.slides[0];
  const exportFileName = useMemo(
    () => `${config.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "carousel"}.pdf`,
    [config.title],
  );

  function showNotice(next: Notice) {
    setNotice(next);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function updateSlide(patch: Partial<CarouselSlide>) {
    setConfig((current) => ({
      ...current,
      slides: current.slides.map((slide, index) => index === selectedIndex ? { ...slide, ...patch } : slide),
    }));
  }

  function addSlide() {
    const slide: CarouselSlide = {
      id: `slide-${Date.now().toString(36)}`,
      layout: "content",
      kicker: "New idea",
      title: "Add a clear headline",
      body: "Use one thought per slide. Keep the supporting copy short.",
    };
    setConfig((current) => ({ ...current, slides: [...current.slides, slide] }));
    setSelectedIndex(config.slides.length);
  }

  function duplicateSlide() {
    const copy = { ...selectedSlide, id: `slide-${Date.now().toString(36)}` };
    setConfig((current) => {
      const slides = [...current.slides];
      slides.splice(selectedIndex + 1, 0, copy);
      return { ...current, slides };
    });
    setSelectedIndex(selectedIndex + 1);
  }

  function deleteSlide() {
    if (config.slides.length === 1) {
      showNotice({ kind: "error", message: "A carousel needs at least one slide." });
      return;
    }
    setConfig((current) => ({ ...current, slides: current.slides.filter((_, index) => index !== selectedIndex) }));
    setSelectedIndex(Math.max(0, selectedIndex - 1));
  }

  function moveSlide(direction: -1 | 1) {
    const nextIndex = selectedIndex + direction;
    if (nextIndex < 0 || nextIndex >= config.slides.length) return;
    setConfig((current) => {
      const slides = [...current.slides];
      [slides[selectedIndex], slides[nextIndex]] = [slides[nextIndex], slides[selectedIndex]];
      return { ...current, slides };
    });
    setSelectedIndex(nextIndex);
  }

  async function uploadBackgrounds(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    try {
      const images = await readImages(event.target.files);
      setBackgrounds((current) => [...current, ...images].slice(0, 12));
      if (!selectedSlide.background && images[0]) updateSlide({ background: images[0] });
      showNotice({ kind: "success", message: `${images.length} background${images.length === 1 ? "" : "s"} added.` });
    } catch (error) {
      showNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not add that image." });
    }
    event.target.value = "";
  }

  function openComposer(mode: "text" | "json") {
    setComposeMode(mode);
    setJsonText(JSON.stringify(config, null, 2));
    setComposeOpen(true);
  }

  function applyComposer() {
    try {
      const next = composeMode === "json"
        ? parseCarouselConfig(jsonText)
        : generateCarouselFromText(sourceText, { author: config.author, template: config.template });
      setConfig(next);
      setSelectedIndex(0);
      setComposeOpen(false);
      showNotice({ kind: "success", message: `Created ${next.slides.length} slides. They are ready to edit.` });
    } catch (error) {
      showNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not create the carousel." });
    }
  }

  async function copyAiPrompt() {
    await navigator.clipboard.writeText(aiPrompt(config));
    showNotice({ kind: "success", message: "AI prompt copied. Add your source text in Claude or Codex." });
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFileName.replace(/\.pdf$/, ".json");
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    if (exporting) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      const [{ toPng }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-export-slide='true']"));
      if (nodes.length !== config.slides.length) throw new Error("The slides are not ready to export.");

      const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [1080, 1350], hotfixes: ["px_scaling"] });
      for (let index = 0; index < nodes.length; index += 1) {
        if (index > 0) pdf.addPage([1080, 1350], "portrait");
        const image = await toPng(nodes[index], {
          width: 1080,
          height: 1350,
          canvasWidth: 1080,
          canvasHeight: 1350,
          pixelRatio: 1,
          cacheBust: true,
        });
        pdf.addImage(image, "PNG", 0, 0, 1080, 1350, undefined, "FAST");
      }
      pdf.save(exportFileName);
      showNotice({ kind: "success", message: `Exported ${config.slides.length} PDF pages for LinkedIn.` });
    } catch (error) {
      showNotice({ kind: "error", message: error instanceof Error ? error.message : "PDF export failed." });
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="studio-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Vertica home"><span className="brand-mark">V</span><span>Vertica</span></Link>
        <label className="project-name">
          <span className="status-dot" />
          <input aria-label="Carousel title" maxLength={100} value={config.title} onChange={(event) => setConfig({ ...config, title: event.target.value })} />
        </label>
        <div className="topbar-actions">
          <button className="secondary-button generate-button" type="button" onClick={() => openComposer("text")}><Sparkles size={15} /> Generate</button>
          <button className="export-button" type="button" onClick={exportPdf} disabled={exporting}>
            {exporting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
            {exporting ? "Exporting…" : "Export PDF"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="rail">
          <div className="rail-heading"><span>Slides · {config.slides.length}</span><button type="button" onClick={addSlide} aria-label="Add slide"><Plus size={15} /></button></div>
          <div className="slide-list">
            {config.slides.map((slide, index) => (
              <button className={`slide-thumb ${index === selectedIndex ? "selected" : ""}`} type="button" key={slide.id} onClick={() => setSelectedIndex(index)}>
                <span className="thumb-number">{String(index + 1).padStart(2, "0")}</span>
                <span className={`thumb-card template-${config.template}`}><span>{slide.title.slice(0, 16)}</span></span>
                <span className="thumb-label">{slide.layout === "cover" ? "Cover" : slide.kicker || "Slide"}</span>
              </button>
            ))}
          </div>
          <div className="rail-import">
            <span>Backgrounds</span>
            <label className="upload-tile"><ImagePlus size={16} /><span>Upload images</span><input type="file" accept="image/*" multiple onChange={uploadBackgrounds} /></label>
            {backgrounds.length > 0 && (
              <div className="asset-grid">
                {backgrounds.map((background, index) => (
                  <button type="button" className={selectedSlide.background === background ? "active" : ""} onClick={() => updateSlide({ background })} key={`${background.slice(-20)}-${index}`} aria-label={`Use background ${index + 1}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src={background} />
                    {selectedSlide.background === background && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="canvas-area" aria-label="Slide preview">
          <div className="canvas-toolbar"><span>LinkedIn portrait · 1080 × 1350</span><span>{selectedIndex + 1} of {config.slides.length}</span></div>
          <div className="preview-frame"><Slide slide={selectedSlide} config={config} index={selectedIndex} /></div>
          <div className="slide-actions" aria-label="Slide actions">
            <button type="button" onClick={() => moveSlide(-1)} disabled={selectedIndex === 0} aria-label="Move slide up"><ArrowUp size={15} /></button>
            <button type="button" onClick={() => moveSlide(1)} disabled={selectedIndex === config.slides.length - 1} aria-label="Move slide down"><ArrowDown size={15} /></button>
            <button type="button" onClick={duplicateSlide}><Copy size={14} /> Duplicate</button>
            <button className="danger-action" type="button" onClick={deleteSlide}><Trash2 size={14} /> Delete</button>
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-tabs">
            <button className={inspectorTab === "content" ? "active" : ""} onClick={() => setInspectorTab("content")} type="button">Content</button>
            <button className={inspectorTab === "design" ? "active" : ""} onClick={() => setInspectorTab("design")} type="button">Design</button>
          </div>

          {inspectorTab === "content" ? (
            <div className="inspector-panel">
              <label className="field-label" htmlFor="slide-layout">Slide type</label>
              <div className="select-wrap"><select id="slide-layout" value={selectedSlide.layout} onChange={(event) => updateSlide({ layout: event.target.value as CarouselSlide["layout"] })}><option value="cover">Cover</option><option value="content">Content</option><option value="quote">Quote</option><option value="closing">Closing</option></select><ChevronDown size={14} /></div>
              <label className="field-label" htmlFor="kicker">Kicker</label>
              <input id="kicker" maxLength={50} value={selectedSlide.kicker} onChange={(event) => updateSlide({ kicker: event.target.value })} />
              <label className="field-label" htmlFor="headline">Headline</label>
              <textarea id="headline" maxLength={90} rows={5} value={selectedSlide.title} onChange={(event) => updateSlide({ title: event.target.value })} />
              <div className="character-count">{selectedSlide.title.length} / 90</div>
              <label className="field-label" htmlFor="body">Supporting copy</label>
              <textarea id="body" maxLength={280} rows={6} value={selectedSlide.body} onChange={(event) => updateSlide({ body: event.target.value })} />
            </div>
          ) : (
            <div className="inspector-panel">
              <span className="field-label">Template</span>
              <div className="template-options">
                {(["editorial", "signal"] as TemplateId[]).map((template) => (
                  <button type="button" className={config.template === template ? "active" : ""} key={template} onClick={() => setConfig({ ...config, template })}>
                    <span className={`template-swatch ${template}`}><i /><i /><i /></span>
                    <span><strong>{template === "editorial" ? "Editorial" : "Signal"}</strong><small>{template === "editorial" ? "Warm, considered" : "Bold, direct"}</small></span>
                    {config.template === template && <Check size={15} />}
                  </button>
                ))}
              </div>
              <label className="field-label" htmlFor="author">Footer name</label>
              <input id="author" maxLength={40} value={config.author} onChange={(event) => setConfig({ ...config, author: event.target.value.toUpperCase() })} />
              <span className="field-label">Slide background</span>
              <label className="wide-upload"><Upload size={15} /> Upload an image<input type="file" accept="image/*" onChange={uploadBackgrounds} /></label>
              {selectedSlide.background && <button type="button" className="text-button" onClick={() => updateSlide({ background: undefined })}>Remove image</button>}
              <div className="config-tools">
                <span className="field-label">Project data</span>
                <button type="button" onClick={() => openComposer("json")}><Layers3 size={15} /> Edit JSON config</button>
                <button type="button" onClick={downloadJson}><Download size={15} /> Download config</button>
              </div>
            </div>
          )}
        </aside>
      </section>

      <div className="export-stage" aria-hidden="true">
        {config.slides.map((slide, index) => <Slide key={slide.id} slide={slide} config={config} index={index} exportMode />)}
      </div>

      {composeOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setComposeOpen(false); }}>
          <section className="composer-dialog" role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <div className="dialog-header">
              <div><span className="dialog-icon"><Sparkles size={17} /></span><div><h2 id="composer-title">Create a carousel</h2><p>Start with raw text or bring a config from Claude or Codex.</p></div></div>
              <button type="button" onClick={() => setComposeOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="mode-tabs">
              <button className={composeMode === "text" ? "active" : ""} type="button" onClick={() => setComposeMode("text")}>Paste text</button>
              <button className={composeMode === "json" ? "active" : ""} type="button" onClick={() => setComposeMode("json")}>JSON config</button>
            </div>
            {composeMode === "text" ? (
              <div className="composer-body">
                <label htmlFor="source-text">Source text</label>
                <textarea id="source-text" rows={12} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste an article, notes, or a rough idea. Separate sections with blank lines for more control…" />
                <p>Vertica turns each paragraph into a slide. You can edit every word afterward.</p>
              </div>
            ) : (
              <div className="composer-body">
                <div className="json-label"><label htmlFor="json-config">Carousel config</label><button type="button" onClick={copyAiPrompt}><Copy size={13} /> Copy AI prompt</button></div>
                <textarea className="json-editor" id="json-config" rows={15} value={jsonText} onChange={(event) => setJsonText(event.target.value)} spellCheck={false} />
                <p>Ask Claude or Codex to return this shape, then paste the result here.</p>
              </div>
            )}
            <div className="dialog-footer"><button className="secondary-button" type="button" onClick={() => setComposeOpen(false)}>Cancel</button><button className="primary-button" type="button" onClick={applyComposer}><Sparkles size={15} /> {composeMode === "text" ? "Create slides" : "Apply config"}</button></div>
          </section>
        </div>
      )}

      {notice && <div className={`toast ${notice.kind}`} role="status">{notice.kind === "success" ? <Check size={16} /> : <X size={16} />}{notice.message}</div>}
    </main>
  );
}
