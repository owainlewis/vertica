"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Download,
  Images,
  Layers3,
  LoaderCircle,
  Plus,
  Redo2,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveCarousel, StaleSaveError, type CarouselSummary, type MediaAsset } from "./api-client";
import { isImageKey, loadImages } from "./image-store";
import MediaPicker from "./media-picker";
import { measureDataUrl } from "./scrim";
import {
  aiPrompt,
  assertBackgroundsAvailableForExport,
  CarouselConfig,
  CarouselSlide,
  deckTypeScale,
  generateCarouselFromText,
  parseCarouselConfig,
  slideAlign,
  SlideAlign,
  slidePosition,
  SlidePosition,
  slideTemplate,
  TemplateId,
} from "./carousel";
import { downloadBlob, exportStageToPdf, exportStageToZip, fileNameFor } from "./export";
import { SaveQueue } from "./save-queue";
import { ExportStage, Slide } from "./slide";

type Notice = { kind: "success" | "error"; message: string } | null;

const SAVE_LABEL = {
  saved: "Saved",
  dirty: "Unsaved",
  saving: "Saving\u2026",
  error: "Not saved",
  stale: "Out of date",
} as const;

const templateNames: Record<TemplateId, { name: string; note: string }> = {
  dark: { name: "Dark", note: "Near-black with blue-grey type" },
  light: { name: "Light", note: "Soft white with blue-grey ink" },
};

/** Longest a burst of edits can be folded into one undo step. */
const COALESCE_MS = 700;
const HISTORY_LIMIT = 60;

export default function Editor({
  carouselId,
  initialConfig,
  initialVersion,
  onExit,
  onSaved,
}: {
  carouselId: string | null;
  initialConfig: CarouselConfig;
  initialVersion: number | null;
  onExit: () => void;
  onSaved: (summary: CarouselSummary) => void;
}) {
  const [config, setConfig] = useState<CarouselConfig>(initialConfig);
  const [showCrop, setShowCrop] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<"content" | "layout" | "design">("content");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"text" | "json">("text");
  const [sourceText, setSourceText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [exporting, setExporting] = useState<false | "pdf" | "zip">(false);
  const [saveState, setSaveState] = useState<keyof typeof SAVE_LABEL>("saved");
  const [exiting, setExiting] = useState(false);

  const mounted = useRef(true);
  const savedIdRef = useRef(carouselId);
  const savedVersionRef = useRef(initialVersion);
  const onSavedRef = useRef(onSaved);
  const saveQueueRef = useRef<SaveQueue<CarouselConfig, CarouselSummary> | null>(null);

  useEffect(() => {
    const queue = new SaveQueue<CarouselConfig, CarouselSummary>(async (nextConfig) => {
      const summary = await saveCarousel(savedIdRef.current, nextConfig, savedVersionRef.current);
      savedIdRef.current = summary.id;
      savedVersionRef.current = summary.version;

      if (mounted.current) {
        onSavedRef.current(summary);
      }

      return summary;
    });
    saveQueueRef.current = queue;
    return () => { saveQueueRef.current = null; };
  }, []);

  const selectedSlide = config.slides[selectedIndex] ?? config.slides[0];
  const activeTemplate = slideTemplate(selectedSlide, config);
  const activePosition = slidePosition(selectedSlide);
  const activeAlign = slideAlign(selectedSlide);
  const typeScale = useMemo(() => deckTypeScale(config.slides), [config.slides]);
  const exportFileName = useMemo(() => fileNameFor(config.title), [config.title]);
  const zipFileName = useMemo(() => fileNameFor(config.title, "zip"), [config.title]);

  function showNotice(next: Notice) {
    setNotice(next);
    window.setTimeout(() => setNotice(null), 3200);
  }

  const flushSave = useCallback(async () => {
    const queue = saveQueueRef.current;
    if (!queue) return false;
    if (!queue.dirty) return true;

    setSaveState("saving");
    try {
      await queue.flush();
      if (mounted.current) setSaveState(queue.dirty ? "dirty" : "saved");
      return !queue.dirty;
    } catch (error) {
      if (mounted.current) {
        setSaveState(error instanceof StaleSaveError ? "stale" : "error");
        setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not save." });
      }
      return false;
    }
  }, []);

  // Undo holds whole configs. The deck is a small plain object, so keeping sixty of
  // them costs less than the machinery to diff them would.
  const past = useRef<CarouselConfig[]>([]);
  const future = useRef<CarouselConfig[]>([]);
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const lastMark = useRef({ key: "", at: 0 });

  /**
   * Every change to the deck goes through here so it can be undone. Typing would
   * otherwise put one entry on the stack per keystroke, so edits that share a key and
   * land within COALESCE_MS are folded into the step already recorded, which keeps the
   * state from before the burst rather than from the middle of it.
   */
  function commit(next: CarouselConfig, key = "") {
    // This runs only in user and async callbacks, never while rendering.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const continuing = key !== "" && key === lastMark.current.key && now - lastMark.current.at < COALESCE_MS;
    if (!continuing) past.current = [...past.current, config].slice(-HISTORY_LIMIT);
    lastMark.current = { key, at: now };
    future.current = [];
    setDepth({ past: past.current.length, future: 0 });
    setConfig(next);
  }

  const step = useCallback((from: "past" | "future") => {
    const source = from === "past" ? past : future;
    const target = from === "past" ? future : past;
    const next = source.current.at(-1);
    if (!next) return;
    source.current = source.current.slice(0, -1);
    target.current = [...target.current, config].slice(-HISTORY_LIMIT);
    setConfig(next);
    // A slide the undone step had added may no longer be there to select.
    setSelectedIndex((index) => Math.min(index, next.slides.length - 1));
    lastMark.current = { key: "", at: 0 };
    setDepth({ past: past.current.length, future: future.current.length });
  }, [config]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      step(event.shiftKey ? "future" : "past");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Set on the way in as well as cleared on the way out. With only the cleanup, a
  // StrictMode mount/cleanup/mount cycle would leave this false for good and every
  // save result would be discarded.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  // Every edit replaces the queued snapshot. The queue drains one request at a time,
  // adopting the returned id and version before it writes anything newer.
  const lastQueuedConfig = useRef(initialConfig);
  useEffect(() => {
    if (config === lastQueuedConfig.current) return;
    lastQueuedConfig.current = config;
    saveQueueRef.current?.enqueue(config);
    setSaveState("dirty");

    const timer = window.setTimeout(() => { void flushSave(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [config, flushSave]);

  // Refreshing or closing cannot reliably finish an async request, so the browser
  // warns instead of silently discarding a queued or in-flight edit.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!saveQueueRef.current?.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Back is same-document navigation here, so beforeunload does not run. Hold the
  // editor in place, flush it, then repeat the Back action with a clean queue.
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      if (!saveQueueRef.current?.dirty) return;
      event.stopImmediatePropagation();
      const editorUrl = savedIdRef.current ? `/?id=${encodeURIComponent(savedIdRef.current)}` : "/";
      window.history.pushState(savedIdRef.current ? { id: savedIdRef.current } : {}, "", editorUrl);
      void flushSave().then((saved) => {
        if (saved && mounted.current) window.history.back();
      });
    };
    window.addEventListener("popstate", onPop, { capture: true });
    return () => window.removeEventListener("popstate", onPop, { capture: true });
  }, [flushSave]);

  /**
   * `key` groups a burst of edits into one undo step. Text fields pass a stable key
   * so a sentence typed straight through undoes as a sentence; discrete choices pass
   * nothing so each one is its own step.
   */
  function updateSlide(patch: Partial<CarouselSlide>, key = "") {
    commit(
      {
        ...config,
        slides: config.slides.map((slide, index) => index === selectedIndex ? { ...slide, ...patch } : slide),
      },
      key && `${key}:${selectedIndex}`,
    );
  }

  function addSlide() {
    const slide: CarouselSlide = {
      // Event-time uniqueness keeps imported and duplicated slide ids distinct.
      // eslint-disable-next-line react-hooks/purity
      id: `slide-${Date.now().toString(36)}`,
      layout: "content",
      title: "Add a clear headline",
      body: "Use one thought per slide. Keep the supporting copy short.",
    };
    commit({ ...config, slides: [...config.slides, slide] });
    setSelectedIndex(config.slides.length);
  }

  function duplicateSlide() {
    // eslint-disable-next-line react-hooks/purity
    const copy = { ...selectedSlide, id: `slide-${Date.now().toString(36)}` };
    const slides = [...config.slides];
    slides.splice(selectedIndex + 1, 0, copy);
    commit({ ...config, slides });
    setSelectedIndex(selectedIndex + 1);
  }

  function deleteSlide() {
    if (config.slides.length === 1) {
      showNotice({ kind: "error", message: "A carousel needs at least one slide." });
      return;
    }
    commit({ ...config, slides: config.slides.filter((_, index) => index !== selectedIndex) });
    setSelectedIndex(Math.max(0, selectedIndex - 1));
    showNotice({ kind: "success", message: "Slide deleted. Undo with ⌘Z." });
  }

  function moveSlide(direction: -1 | 1) {
    const nextIndex = selectedIndex + direction;
    if (nextIndex < 0 || nextIndex >= config.slides.length) return;
    const slides = [...config.slides];
    [slides[selectedIndex], slides[nextIndex]] = [slides[nextIndex], slides[selectedIndex]];
    commit({ ...config, slides });
    setSelectedIndex(nextIndex);
  }

  /**
   * Picking an image also records how bright it is, which is what sizes the scrim.
   * The image lands straight away and the measurement follows, because decoding a
   * full-size photograph is slow enough to feel like lag on the click.
   *
   * That second write is deliberately not an undo step and does not go through
   * commit: it is derived from the image rather than chosen by anyone, so undo should
   * step over the whole thing. It matches on the image itself, so it still lands if
   * the selection has moved on, and it fixes every slide sharing that photograph.
   */
  async function chooseBackground(background: string) {
    updateSlide({ background, luma: undefined });
    const luma = await measureDataUrl(background);
    if (!luma) return;
    setConfig((current) => ({
      ...current,
      slides: current.slides.map((slide) => (slide.background === background ? { ...slide, luma } : slide)),
    }));
  }

  async function chooseMedia(asset: MediaAsset) {
    const images = await loadImages([asset.key]);
    const background = images[asset.key];
    if (!background) throw new Error("That image could not be loaded. Try uploading it again from Media.");
    await chooseBackground(background);
    setMediaOpen(false);
    showNotice({ kind: "success", message: `${asset.name} is now the slide background.` });
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
      // Through commit, so replacing a whole deck by mistake is undoable.
      commit(next);
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
    downloadBlob(blob, exportFileName.replace(/\.pdf$/, ".json"));
  }

  async function requestExit() {
    if (exiting) return;
    setExiting(true);
    if (await flushSave()) onExit();
    else setExiting(false);
  }

  async function runExport(kind: "pdf" | "zip") {
    if (exporting) return;
    setExporting(kind);
    try {
      assertBackgroundsAvailableForExport(config);
      if (kind === "pdf") {
        await exportStageToPdf(exportFileName, config.slides.length);
        showNotice({ kind: "success", message: `Exported ${config.slides.length} PDF pages for LinkedIn.` });
      } else {
        await exportStageToZip(zipFileName, config.slides.length);
        showNotice({ kind: "success", message: `Exported ${config.slides.length} numbered JPEGs for Instagram.` });
      }
    } catch (error) {
      showNotice({ kind: "error", message: error instanceof Error ? error.message : "The export failed." });
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="studio-shell">
      <header className="topbar">
        <button className="brand brand-back" type="button" onClick={() => { void requestExit(); }} disabled={exiting} aria-label="Back to all carousels">
          {exiting ? <LoaderCircle className="spin" size={16} /> : <ArrowLeft size={16} />}<span className="brand-mark">V</span><span>All carousels</span>
        </button>
        <label className="project-name">
          <span className={`status-dot ${saveState}`} title={SAVE_LABEL[saveState]} />
          <input aria-label="Carousel title" maxLength={100} value={config.title} onChange={(event) => commit({ ...config, title: event.target.value }, "deck-title")} />
        </label>
        <div className="topbar-actions">
          <span className="save-state">{SAVE_LABEL[saveState]}</span>
          <button className="secondary-button icon-button" type="button" onClick={() => step("past")} disabled={depth.past === 0} title="Undo (⌘Z)" aria-label="Undo"><Undo2 size={15} /></button>
          <button className="secondary-button icon-button" type="button" onClick={() => step("future")} disabled={depth.future === 0} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 size={15} /></button>
          <button className="secondary-button generate-button" type="button" onClick={() => openComposer("text")} aria-label="Generate carousel"><Sparkles size={15} /> <span>Generate</span></button>
          <button className="secondary-button export-images-button" type="button" onClick={() => runExport("zip")} disabled={Boolean(exporting)} title="Numbered JPEGs, zipped, for Instagram">
            {exporting === "zip" ? <LoaderCircle className="spin" size={15} /> : <Images size={15} />}
            {exporting === "zip" ? "Zipping…" : "Images"}
          </button>
          <button className="export-button" type="button" onClick={() => runExport("pdf")} disabled={Boolean(exporting)}>
            {exporting === "pdf" ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
            {exporting === "pdf" ? "Exporting…" : "Export PDF"}
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
                <span className={`thumb-card template-${slideTemplate(slide, config)}`}><span>{slide.title.slice(0, 16)}</span></span>
                <span className="thumb-label">{slide.layout === "cover" ? "Cover" : slide.layout === "closing" ? "Closing" : slide.layout === "quote" ? "Quote" : "Slide"}</span>
              </button>
            ))}
          </div>
          <div className="rail-import">
            <span>Background</span>
            <button className="library-picker-button" type="button" onClick={() => setMediaOpen(true)}><Images size={16} /><span>Choose from media</span></button>
            <small>Reuse images from your shared library.</small>
          </div>
        </aside>

        <section className="canvas-area" aria-label="Slide preview">
          <div className="canvas-toolbar">
            <span>LinkedIn portrait · 1080 × 1350</span>
            <button className="crop-toggle" type="button" aria-pressed={showCrop} onClick={() => setShowCrop(!showCrop)} title="Instagram crops the profile grid to a square">
              <Square size={11} /> Grid crop
            </button>
            <span>{selectedIndex + 1} of {config.slides.length}</span>
          </div>
          <div className="preview-frame">
            <Slide slide={selectedSlide} config={config} scale={typeScale} index={selectedIndex} />
            {showCrop && <div className="crop-guide" />}
          </div>
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
            <button className={inspectorTab === "layout" ? "active" : ""} onClick={() => setInspectorTab("layout")} type="button">Layout</button>
            <button className={inspectorTab === "design" ? "active" : ""} onClick={() => setInspectorTab("design")} type="button">Design</button>
          </div>

          {inspectorTab === "layout" ? (
            <div className="inspector-panel">
              <label className="field-label" htmlFor="slide-layout">Slide type</label>
              <div className="select-wrap"><select id="slide-layout" value={selectedSlide.layout} onChange={(event) => updateSlide({ layout: event.target.value as CarouselSlide["layout"] })}><option value="cover">Cover</option><option value="content">Content</option><option value="quote">Quote</option><option value="closing">Closing</option></select><ChevronDown size={14} /></div>

              <span className="field-label">Text position</span>
              <div className="segmented">
                {(["top", "middle", "bottom"] as SlidePosition[]).map((position) => (
                  <button type="button" key={position} className={activePosition === position ? "active" : ""} onClick={() => updateSlide({ position })}>
                    {position === "top" ? "Top" : position === "middle" ? "Middle" : "Bottom"}
                  </button>
                ))}
              </div>

              <span className="field-label">Alignment</span>
              <div className="segmented">
                {(["left", "center"] as SlideAlign[]).map((align) => (
                  <button type="button" key={align} className={activeAlign === align ? "active" : ""} onClick={() => updateSlide({ align })}>
                    {align === "left" ? "Left" : "Centred"}
                  </button>
                ))}
              </div>

              <button type="button" className="text-button subtle" onClick={() => commit({ ...config, slides: config.slides.map((slide) => ({ ...slide, position: activePosition, align: activeAlign })) })}>
                Apply this layout to every slide
              </button>

              {selectedSlide.layout === "cover" && (
                <p className="field-hint">A cover shows the headline on its own. Position and alignment still apply.</p>
              )}
            </div>
          ) : inspectorTab === "content" ? (
            <div className="inspector-panel">
              <label className="field-label" htmlFor="headline">Headline</label>
              <textarea id="headline" maxLength={90} rows={5} value={selectedSlide.title} onChange={(event) => updateSlide({ title: event.target.value }, "title")} />
              <div className="character-count">{selectedSlide.title.length} / 90</div>
              <p className="field-hint">Put a <em>|</em> where the headline should break. Without one the lines are evened automatically, which rarely breaks where the sense does.</p>
              <label className="field-label" htmlFor="body">Supporting copy</label>
              <textarea id="body" maxLength={280} rows={6} value={selectedSlide.body} onChange={(event) => updateSlide({ body: event.target.value }, "body")} />
              <p className="field-hint"><em>*word*</em> sets a phrase in italic. <em>**word**</em> tints it with the accent colour. Leave a blank line to start a new paragraph.</p>
              {selectedSlide.layout === "cover" && (
                <p className="field-hint">This slide is a Cover, so only the headline is drawn. The supporting copy is kept — change the slide type under Layout to show it.</p>
              )}
            </div>
          ) : (
            <div className="inspector-panel">
              <span className="field-label">Style · slide {selectedIndex + 1}</span>
              <div className="template-options">
                {(Object.keys(templateNames) as TemplateId[]).map((template) => (
                  <button type="button" className={activeTemplate === template ? "active" : ""} key={template} onClick={() => updateSlide({ template })}>
                    <span className={`template-swatch ${template}`}><i /><i /><i /></span>
                    <span><strong>{templateNames[template].name}</strong><small>{templateNames[template].note}</small></span>
                    {activeTemplate === template && <Check size={15} />}
                  </button>
                ))}
              </div>
              {config.slides.some((slide) => slideTemplate(slide, config) !== activeTemplate) ? (
                <p className="field-hint">
                  Other slides use a different style.{" "}
                  <button type="button" className="text-button subtle inline" onClick={() => commit({ ...config, template: activeTemplate, slides: config.slides.map((slide) => ({ ...slide, template: undefined })) })}>
                    Make them all {templateNames[activeTemplate].name.toLowerCase()}
                  </button>
                </p>
              ) : (
                <button type="button" className="text-button subtle" onClick={() => commit({ ...config, template: activeTemplate, slides: config.slides.map((slide) => ({ ...slide, template: undefined })) })}>
                  Apply this style to every slide
                </button>
              )}
              <label className="field-label" htmlFor="author">Footer name</label>
              <input id="author" maxLength={40} value={config.author} onChange={(event) => commit({ ...config, author: event.target.value.toUpperCase() }, "author")} />
              <span className="field-label">Slide background</span>
              <button className="wide-upload" type="button" onClick={() => setMediaOpen(true)}><Images size={15} /> {selectedSlide.background ? "Choose another image" : "Choose from media"}</button>
              {isImageKey(selectedSlide.background) && (
                <p className="field-hint warning">
                  This slide has an image that is not available in this browser, so it cannot be shown or exported here.
                  It is kept in the saved carousel. If it predates media persistence, add it to Media again or choose a replacement from your library.
                </p>
              )}
              {selectedSlide.background && <button type="button" className="text-button" onClick={() => updateSlide({ background: undefined, luma: undefined })}>Remove image</button>}
              <div className="config-tools">
                <span className="field-label">Project data</span>
                <button type="button" onClick={() => openComposer("json")}><Layers3 size={15} /> Edit JSON config</button>
                <button type="button" onClick={downloadJson}><Download size={15} /> Download config</button>
              </div>
            </div>
          )}
        </aside>
      </section>

      <ExportStage config={config} scale={typeScale} />

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

      {mediaOpen && <MediaPicker onChoose={chooseMedia} onClose={() => setMediaOpen(false)} />}

      {notice && <div className={`toast ${notice.kind}`} role="status">{notice.kind === "success" ? <Check size={16} /> : <X size={16} />}{notice.message}</div>}
    </main>
  );
}
