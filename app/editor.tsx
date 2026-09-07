import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Download,
  Images,
  Layers3,
  Plus,
  Redo2,
  Sparkles,
  RectangleVertical,
  Eye,
  Film,
  Pause,
  Play,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { saveCarousel, StaleSaveError, type CarouselSummary, type MediaAsset } from "./api-client";
import { isImageKey, loadImages } from "./image-store";
import Dialog from "./dialog";
import ExportMenu from "./export-menu";
import ReaderPreview from "./reader-preview";
import MediaPicker from "./media-picker";
import VideoPicker from "./video-picker";
import { boundVideoBackground, parseVideoBackground } from "./video-formats";
import {
  aiPrompt,
  assertBackgroundsAvailableForExport,
  CarouselConfig,
  CarouselSlide,
  generateCarouselFromText,
  imageCapacity,
  parseCarouselConfig,
  slideAlign,
  SlideAlign,
  SlideLayout,
  showsBody,
  slidePosition,
  SlidePosition,
  titleLines,
  usesImages,
} from "./carousel";
import { downloadBlob, exportStageToMp4, exportStageToPdf, exportStageToZip, fileNameFor } from "./export";
import { SaveQueue } from "./save-queue";
import { DEFAULT_VEIL, ExportStage, Slide } from "./slide";

type Notice = { kind: "success" | "error"; message: string } | null;

/** What the shell can ask of an open editor: finish saving before leaving it. */
export type EditorHandle = { flush: () => Promise<boolean> };

const SAVE_LABEL = {
  saved: "Saved",
  dirty: "Unsaved",
  saving: "Saving\u2026",
  error: "Not saved",
  stale: "Out of date",
} as const;

const layoutNames: Record<SlideLayout, string> = {
  cover: "Cover",
  content: "Content",
  note: "Note",
  poster: "Poster",
  diagram: "Diagram",
  photos: "Photos",
  closing: "Closing",
};

const layoutHints: Record<SlideLayout, string> = {
  cover: "The headline large, with the supporting copy as a one-line subtitle at the foot.",
  content: "A headline with copy underneath. The workhorse.",
  note: "One plain sans statement, no headline. The title is the statement; **bold** marks the phrase that matters.",
  poster: "One short serif statement, oversized. Title only.",
  diagram: "An SVG figure with the headline as its caption. Title only. Bottom puts the caption under the figure, Top above it.",
  photos: "Pictures under a one-line title. One picture is a figure, two or three a filmstrip, four or more a grid.",
  closing: "A headline and one line to finish on.",
};

/** Where a picked image goes: behind the copy or into the slide's pictures. */
type MediaTarget = "background" | "images";

/**
 * Signifier is loaded from the machine, not bundled, because its web licence is
 * separate. Where it is missing the slides fall back to Georgia, and the export
 * would ship that way without anyone noticing.
 */
function useSignifierCheck() {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (typeof FontFace === "undefined") return;
    let live = true;
    // document.fonts.check() answers "is nothing still loading", which is true for a
    // local() face that failed as well as one that loaded, so it cannot tell the two
    // apart. Loading a probe face rejects when the machine has no such font.
    new FontFace("Signifier Probe", 'local("Signifier Regular"), local("Signifier-Regular")')
      .load()
      .then(() => { if (live) setMissing(false); })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, []);
  return missing;
}

/** Longest a burst of edits can be folded into one undo step. */
const COALESCE_MS = 700;

/* Clock and id reads live outside the component so the compiler can see they only
   run from event handlers, never from render. */
function clockNow() {
  return Date.now();
}
function newSlideId() {
  // Event-time uniqueness keeps imported and duplicated slide ids distinct.
  return `slide-${crypto.randomUUID()}`;
}
const HISTORY_LIMIT = 60;

export default function Editor({
  ref,
  carouselId,
  initialConfig,
  initialVersion,
  onExit,
  onSaved,
}: {
  ref?: Ref<EditorHandle>;
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
  const [readerOpen, setReaderOpen] = useState(false);
  const [composeMessage, setComposeMessage] = useState<Notice>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [composeMode, setComposeMode] = useState<"text" | "json">("text");
  const [sourceText, setSourceText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [mediaOpen, setMediaOpen] = useState<MediaTarget | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [exporting, setExporting] = useState<false | "pdf" | "zip" | "mp4">(false);
  const [saveState, setSaveState] = useState<keyof typeof SAVE_LABEL>("saved");
  const [exiting, setExiting] = useState(false);

  const mounted = useRef(true);
  // Set when the user chooses to reload out of a stale deck, so the unload warning
  // does not fire on a departure they just asked for.
  const leavingRef = useRef(false);
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
  const signifierMissing = useSignifierCheck();
  const activePosition = slidePosition(selectedSlide);
  const activeAlign = slideAlign(selectedSlide);
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

  useImperativeHandle(ref, () => ({ flush: flushSave }), [flushSave]);

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
    if (exporting) return;
    // This runs only in user and async callbacks, never while rendering.
    const now = clockNow();
    const continuing = key !== "" && key === lastMark.current.key && now - lastMark.current.at < COALESCE_MS;
    if (!continuing) past.current = [...past.current, config].slice(-HISTORY_LIMIT);
    lastMark.current = { key, at: now };
    future.current = [];
    setDepth({ past: past.current.length, future: 0 });
    setConfig(next);
  }

  const step = useCallback((from: "past" | "future") => {
    if (exporting) return;
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
  }, [config, exporting]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Modal text fields own their native undo history, not the deck history.
      if (composeOpen || mediaOpen || videoOpen || readerOpen) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      step(event.shiftKey ? "future" : "past");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, composeOpen, mediaOpen, videoOpen, readerOpen]);

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
      if (leavingRef.current || !saveQueueRef.current?.dirty) return;
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
      id: newSlideId(),
      layout: "content",
      title: "Add a clear headline",
      body: "Use one thought per slide. Keep the supporting copy short.",
    };
    commit({ ...config, slides: [...config.slides, slide] });
    setSelectedIndex(config.slides.length);
  }

  function duplicateSlide() {
    const copy = { ...selectedSlide, id: newSlideId() };
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

  async function chooseMedia(asset: MediaAsset) {
    const target = mediaOpen ?? "background";
    const loaded = await loadImages([asset.key]);
    const data = loaded[asset.key];
    if (!data) throw new Error("That image could not be loaded. Try uploading it again from Media.");

    if (target === "images") {
      const images = [...(selectedSlide.images ?? []), data];
      updateSlide({ images });
      const room = imageCapacity(selectedSlide.layout) - images.length;
      showNotice({ kind: "success", message: room > 0 ? `Added ${asset.name}. Room for ${room} more.` : `Added ${asset.name}.` });
      return;
    }
    updateSlide({ background: data, video: undefined });
    showNotice({ kind: "success", message: `${asset.name} is now the slide background.` });
  }

  function removePicture(at: number) {
    const images = (selectedSlide.images ?? []).filter((_, index) => index !== at);
    updateSlide({ images: images.length ? images : undefined });
  }

  function openComposer(mode: "text" | "json") {
    setComposeMessage(null);
    setComposeMode(mode);
    setJsonText(JSON.stringify(config, null, 2));
    setComposeOpen(true);
  }

  function applyComposer() {
    try {
      const next = composeMode === "json"
        ? parseCarouselConfig(jsonText)
        : generateCarouselFromText(sourceText, config.author);
      // Through commit, so replacing a whole deck by mistake is undoable.
      commit(next);
      setSelectedIndex(0);
      setComposeOpen(false);
      showNotice({ kind: "success", message: `Created ${next.slides.length} slides. They are ready to edit.` });
    } catch (error) {
      setComposeMessage({ kind: "error", message: error instanceof Error ? error.message : "Could not create the carousel." });
    }
  }

  async function copyAiPrompt() {
    try {
      await navigator.clipboard.writeText(aiPrompt(config));
      setComposeMessage({ kind: "success", message: "Prompt copied. Add your source text in Claude or Codex." });
    } catch {
      setComposeMessage({ kind: "error", message: "Could not copy the prompt. Check clipboard access and try again." });
    }
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

  /**
   * A stale deck can never save: every retry carries the version the server has
   * already moved past, so the crumb, the rail and Back would all wait for ever.
   * Reloading fetches the newer version, and the queued edits are given up.
   */
  function reloadStale() {
    leavingRef.current = true;
    window.location.reload();
  }

  async function runExport(kind: "pdf" | "zip" | "mp4") {
    if (exporting) return;
    setExporting(kind);
    try {
      assertBackgroundsAvailableForExport(kind === "mp4" ? { ...config, slides: [selectedSlide] } : config);
      if (kind === "mp4") {
        if (!selectedSlide.video) throw new Error("Choose a slide with a video background.");
        if (!selectedSlide.video.sourceDuration) throw new Error("Wait for the video to load before exporting.");
        parseVideoBackground(selectedSlide.video);
        await exportStageToMp4(fileNameFor(`${config.title}-${String(selectedIndex + 1).padStart(2, "0")}`, "mp4"), config.slides.length, selectedIndex, selectedSlide.video);
        showNotice({ kind: "success", message: `Exported slide ${selectedIndex + 1} as an MP4.` });
      } else if (kind === "pdf") {
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
      <header className="topbar" inert={Boolean(exporting)}>
        <div className="topbar-crumbs">
          <button type="button" onClick={() => { void requestExit(); }} disabled={exiting}>Carousels</button>

        </div>
        <div className="project-name">
          <span className={`status-dot ${saveState}`} title={SAVE_LABEL[saveState]} />
          <input aria-label="Carousel title" maxLength={100} value={config.title} onChange={(event) => commit({ ...config, title: event.target.value }, "deck-title")} />
          <div className="save-indicator">
            {saveState === "stale" ? (
              <button className="secondary-button" type="button" onClick={reloadStale} title="Someone else saved a newer version. Reloading discards the edits queued here.">Reload</button>
            ) : <span className="save-state" role="status">{SAVE_LABEL[saveState]}</span>}
          </div>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button icon-button" type="button" onClick={() => step("past")} disabled={depth.past === 0} title="Undo (⌘Z)" aria-label="Undo"><Undo2 size={15} /></button>
          <button className="secondary-button icon-button" type="button" onClick={() => step("future")} disabled={depth.future === 0} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 size={15} /></button>
          <button className="secondary-button generate-button" type="button" onClick={() => openComposer("text")} aria-label="Create from text" title="Create from text"><Sparkles size={15} /> <span>Create from text</span></button>
          <button className="secondary-button icon-button" type="button" onClick={() => setReaderOpen(true)} aria-label="Reader preview" title="Reader preview"><Eye size={16} /></button>
          <ExportMenu busy={Boolean(exporting)} video={Boolean(selectedSlide.video)} onExport={(kind) => { void runExport(kind); }} />
        </div>
      </header>

      {exporting && <p className="video-export-status" role="status">{exporting === "mp4" ? "Rendering MP4… This may take a minute." : "Exporting slides…"} Keep this tab open.</p>}
      <section className="workspace" inert={Boolean(exporting)}>
        <aside className="rail">
          <div className="rail-heading"><span>Slides</span><button type="button" onClick={addSlide} aria-label="Add slide"><Plus size={15} /></button></div>
          <div className="slide-list">
            {config.slides.map((slide, index) => (
              <button className={`slide-thumb ${index === selectedIndex ? "selected" : ""}`} type="button" key={slide.id} onClick={() => setSelectedIndex(index)} aria-pressed={index === selectedIndex} aria-label={`Slide ${index + 1}: ${titleLines(slide.title).join(" ").replace(/\*/g, "")}`}>
                <span className="thumb-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="thumb-frame" aria-hidden="true"><Slide slide={slide} config={config} index={index} /></span>
                <span className="thumb-label">
                  <strong>{titleLines(slide.title).join(" ").replace(/\*/g, "")}</strong>
                  <small>{layoutNames[slide.layout]}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-area" aria-label="Slide preview">
          {signifierMissing && (
            <p className="font-warning" role="status">
              Signifier is not installed on this machine, so slides are showing Georgia. Exports from here will ship Georgia too. Install Signifier or export from a machine that has it.
            </p>
          )}
          <div className="canvas-toolbar">
            <span>Portrait · 4:5</span>
            <button className="crop-toggle" type="button" aria-pressed={showCrop} onClick={() => setShowCrop(!showCrop)} title="Centered 3:4 profile crop; the exported slide stays 4:5">
              <RectangleVertical size={13} /> Profile crop
            </button>
            <span>{selectedIndex + 1} of {config.slides.length}</span>
          </div>
          <div className="preview-frame">
            <Slide slide={selectedSlide} config={config} index={selectedIndex} videoPreview playing={videoPlaying && !readerOpen} onVideoDuration={(duration) => {
              // Source metadata is derived, so refreshing it must not add an undo
              // step that immediately reappears whenever the user presses Undo.
              if (exporting) return;
              setConfig((current) => {
                const slide = current.slides.find((item) => item.id === selectedSlide.id);
                if (!slide?.video || slide.video.key !== selectedSlide.video?.key) return current;
                const video = boundVideoBackground(slide.video, duration);
                if (video.sourceDuration === slide.video.sourceDuration && video.start === slide.video.start && video.duration === slide.video.duration) return current;
                return { ...current, slides: current.slides.map((item) => item === slide ? { ...slide, video } : item) };
              });
            }} />
            {showCrop && <div className="crop-guide" />}
          </div>
          <div className="slide-actions" aria-label="Slide actions">
            {selectedSlide.video && <button type="button" onClick={() => setVideoPlaying(!videoPlaying)}>{videoPlaying ? <Pause size={14} /> : <Play size={14} />}{videoPlaying ? "Pause video" : "Play video"}</button>}
            <button type="button" onClick={() => moveSlide(-1)} disabled={selectedIndex === 0} aria-label="Move slide up"><ArrowUp size={15} /></button>
            <button type="button" onClick={() => moveSlide(1)} disabled={selectedIndex === config.slides.length - 1} aria-label="Move slide down"><ArrowDown size={15} /></button>
            <button type="button" onClick={duplicateSlide}><Copy size={14} /> Duplicate</button>
            <button className="danger-action" type="button" onClick={deleteSlide}><Trash2 size={14} /> Delete</button>
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-tabs" role="group" aria-label="Slide settings">
            <button aria-pressed={inspectorTab === "content"} className={inspectorTab === "content" ? "active" : ""} onClick={() => setInspectorTab("content")} type="button">Content</button>
            <button aria-pressed={inspectorTab === "layout"} className={inspectorTab === "layout" ? "active" : ""} onClick={() => setInspectorTab("layout")} type="button">Layout</button>
            <button aria-pressed={inspectorTab === "design"} className={inspectorTab === "design" ? "active" : ""} onClick={() => setInspectorTab("design")} type="button">Design</button>
          </div>

          {inspectorTab === "layout" ? (
            <div className="inspector-panel">
              <label className="field-label" htmlFor="slide-layout">Slide type</label>
              <div className="select-wrap"><select id="slide-layout" value={selectedSlide.layout} onChange={(event) => updateSlide({ layout: event.target.value as SlideLayout })}>{(Object.keys(layoutNames) as SlideLayout[]).map((layout) => <option value={layout} key={layout}>{layoutNames[layout]}</option>)}</select><ChevronDown size={14} /></div>

              <span className="field-label">Text position</span>
              <div className="segmented">
                {(["top", "middle", "bottom"] as SlidePosition[]).map((position) => (
                  <button type="button" key={position} aria-pressed={activePosition === position} className={activePosition === position ? "active" : ""} onClick={() => updateSlide({ position })}>
                    {position === "top" ? "Top" : position === "middle" ? "Middle" : "Bottom"}
                  </button>
                ))}
              </div>

              <span className="field-label">Alignment</span>
              <div className="segmented">
                {(["left", "center"] as SlideAlign[]).map((align) => (
                  <button type="button" key={align} aria-pressed={activeAlign === align} className={activeAlign === align ? "active" : ""} onClick={() => updateSlide({ align })}>
                    {align === "left" ? "Left" : "Centred"}
                  </button>
                ))}
              </div>

              <button type="button" className="text-button subtle" onClick={() => commit({ ...config, slides: config.slides.map((slide) => ({ ...slide, position: activePosition, align: activeAlign })) })}>
                Apply position and alignment to all slides
              </button>

              <p className="field-hint">{layoutHints[selectedSlide.layout]}</p>

              <span className="field-label">Header and footer</span>
              <label className="check-row"><input type="checkbox" checked={selectedSlide.showHeader !== false} onChange={(event) => updateSlide({ showHeader: event.target.checked ? undefined : false })} /> Show header</label>
              <label className="check-row"><input type="checkbox" checked={selectedSlide.showFooter !== false} onChange={(event) => updateSlide({ showFooter: event.target.checked ? undefined : false })} /> Show footer</label>
              <p className="field-hint">Header: series label and page number. Footer: author and swipe arrow. These settings apply to this slide.</p>
            </div>
          ) : inspectorTab === "content" ? (
            <div className="inspector-panel">
              <label className="field-label" htmlFor="headline">Headline</label>
              <textarea id="headline" maxLength={120} rows={5} value={selectedSlide.title} onChange={(event) => updateSlide({ title: event.target.value }, "title")} />
              <div className="character-count" style={{ visibility: selectedSlide.title.length >= 100 ? "visible" : "hidden" }}>{selectedSlide.title.length} / 120</div>
              <details className="format-help"><summary>Formatting help</summary><p className="field-hint"><em>|</em> starts a headline line. <em>*italic*</em> adds emphasis. <em>**highlight**</em> marks a phrase. A blank line starts a paragraph.</p></details>
              {showsBody(selectedSlide.layout) ? (
                <>
                  <label className="field-label" htmlFor="body">Supporting copy</label>
                  <textarea id="body" maxLength={280} rows={6} value={selectedSlide.body} onChange={(event) => updateSlide({ body: event.target.value }, "body")} />

                </>
              ) : (
                <p className="field-hint">
                  {layoutNames[selectedSlide.layout]} slides draw the headline only, so nothing can crowd the {selectedSlide.layout === "diagram" ? "figure" : selectedSlide.layout === "photos" ? "pictures" : "statement"}.
                  {selectedSlide.body ? " The supporting copy is kept and comes back if you change the slide type." : ""}
                </p>
              )}
              {selectedSlide.layout === "diagram" && (
                <>
                  <label className="field-label" htmlFor="diagram">Diagram SVG</label>
                  <textarea className="svg-editor" id="diagram" rows={8} spellCheck={false} value={selectedSlide.diagram ?? ""} onChange={(event) => updateSlide({ diagram: event.target.value || undefined }, "diagram")} placeholder='<svg viewBox="0 0 800 500">…</svg>' />
                  <p className="field-hint">Paste inline SVG. Use <em>currentColor</em> for strokes and text so it takes the slide’s ink on any ground. Scripts and external references are stripped. Find Copy AI prompt in Design → Project data → Edit JSON config.</p>
                </>
              )}
              {usesImages(selectedSlide.layout) && (
                <>
                  <span className="field-label">Pictures · {(selectedSlide.images ?? []).length} of {imageCapacity(selectedSlide.layout)}</span>
                  {(selectedSlide.images ?? []).length > 0 && (
                    <ul className="picture-list">
                      {(selectedSlide.images ?? []).map((image, pictureIndex) => (
                        <li
                          key={`${pictureIndex}-${image.slice(-24)}`}
                          className={isImageKey(image) ? "is-missing" : ""}
                          style={isImageKey(image) ? undefined : { backgroundImage: `url(${image})` }}
                          title={isImageKey(image) ? "Not available in this browser" : `Picture ${pictureIndex + 1}`}
                        >
                          <button type="button" onClick={() => removePicture(pictureIndex)} aria-label={`Remove picture ${pictureIndex + 1}`}><X size={12} /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="field-hint">One picture is a figure, two or three a filmstrip, four or more a grid. Grids read best with four or nine.</p>
                  {(selectedSlide.images ?? []).length < imageCapacity(selectedSlide.layout) ? (
                    <button className="wide-upload" type="button" onClick={() => setMediaOpen("images")} style={{ marginTop: 8 }}><Images size={15} /> Add a picture</button>
                  ) : (
                    <p className="field-hint">This layout is full. Remove a picture to add another.</p>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="inspector-panel">
              <h3 className="settings-heading">This slide</h3>
              <span className="field-label">Background colour</span>
              <div className="segmented" aria-label="Slide ground colour">
                <button type="button" aria-pressed={(selectedSlide.tone ?? "paper") === "paper"} className={(selectedSlide.tone ?? "paper") === "paper" ? "active" : ""} onClick={() => updateSlide({ tone: "paper" })}>Paper</button>
                <button type="button" aria-pressed={selectedSlide.tone === "sage"} className={selectedSlide.tone === "sage" ? "active" : ""} onClick={() => updateSlide({ tone: "sage" })}>Sage</button>
                <button type="button" aria-pressed={selectedSlide.tone === "black"} className={selectedSlide.tone === "black" ? "active" : ""} onClick={() => updateSlide({ tone: "black" })}>Black</button>
              </div>
              <span className="field-label">Background photo</span>
              <button className="wide-upload" type="button" onClick={() => setMediaOpen("background")}><Images size={15} /> {selectedSlide.background ? "Choose another image" : "Choose from media"}</button>
              <span className="field-label">Video background · Experimental</span>
              <button className="wide-upload" type="button" onClick={() => setVideoOpen(true)}><Film size={15} /> {selectedSlide.video ? "Change video" : "Choose a video"}</button>
              {selectedSlide.video && <>
                <div className="video-clip-fields">
                  <label className="field-label" htmlFor="video-start">Start (s)<input id="video-start" type="number" min={0} max={Math.max(0, (selectedSlide.video.sourceDuration ?? 0) - selectedSlide.video.duration)} disabled={!selectedSlide.video.sourceDuration} step={0.1} value={selectedSlide.video.start} onChange={(event) => updateSlide({ video: boundVideoBackground({ ...selectedSlide.video!, start: Number(event.target.value) }, selectedSlide.video!.sourceDuration!) }, "video-start")} /></label>
                  <label className="field-label" htmlFor="video-duration">Duration (s)<input id="video-duration" type="number" min={1} max={Math.min(30, (selectedSlide.video.sourceDuration ?? 1) - selectedSlide.video.start)} disabled={!selectedSlide.video.sourceDuration} step={0.1} value={selectedSlide.video.duration} onChange={(event) => updateSlide({ video: { ...selectedSlide.video!, duration: Math.max(1, Math.min(30, selectedSlide.video!.sourceDuration! - selectedSlide.video!.start, Number(event.target.value))) } }, "video-duration")} /></label>
                </div>
                <p className="field-hint">{selectedSlide.video.sourceDuration ? `Source: ${selectedSlide.video.sourceDuration.toFixed(1)}s. ` : "Loading source duration… "}Silent, centred crop. Export → Video slide creates one MP4. PDF and JPEG use the clip’s first frame.</p>
                <button type="button" className="text-button" onClick={() => updateSlide({ video: undefined, veil: undefined })}>Remove video</button>
              </>}
              {isImageKey(selectedSlide.background) && (
                <p className="field-hint warning">
                  This slide has an image that is not available in this browser, so it cannot be shown or exported here.
                  It is kept in the saved carousel. If it predates media persistence, add it to Media again or choose a replacement from your library.
                </p>
              )}
              {(selectedSlide.background || selectedSlide.video) && (
                <>
                  <label className="field-label range-label" htmlFor="veil">
                    <span>Background veil</span>
                    <span>{Math.round((selectedSlide.veil ?? DEFAULT_VEIL) * 100)}%</span>
                  </label>
                  <input id="veil" className="range" type="range" min={0} max={100} step={5} value={Math.round((selectedSlide.veil ?? DEFAULT_VEIL) * 100)} onChange={(event) => updateSlide({ veil: Number(event.target.value) / 100 }, "veil")} />
                  <p className="field-hint">Raise the veil to make text easier to read over a busy background.</p>
                  {selectedSlide.background && <button type="button" className="text-button" onClick={() => updateSlide({ background: undefined, veil: undefined })}>Remove image</button>}
                </>
              )}

              <h3 className="settings-heading settings-divider">All slides</h3>
              <label className="field-label" htmlFor="mark">Series label</label>
              <input id="mark" maxLength={30} value={config.mark ?? ""} placeholder="AI Engineer" onChange={(event) => commit({ ...config, mark: event.target.value }, "mark")} />
              <label className="field-label" htmlFor="author">Footer name</label>
              <input id="author" maxLength={40} value={config.author} onChange={(event) => commit({ ...config, author: event.target.value }, "author")} />
              <label className="check-row"><input type="checkbox" checked={config.arrow !== false} onChange={(event) => commit({ ...config, arrow: event.target.checked ? undefined : false })} /> Swipe arrow on every slide but the last</label>
              <details className="config-tools">
                <summary>Project data</summary>
                <button type="button" onClick={() => openComposer("json")}><Layers3 size={15} /> Edit JSON config</button>
                <button type="button" onClick={downloadJson}><Download size={15} /> Download config</button>
              </details>
            </div>
          )}
        </aside>
      </section>

      <ExportStage config={config} />

      {composeOpen && (
        <Dialog labelId="composer-title" onDismiss={() => setComposeOpen(false)} initialFocus={sourceRef}>
          <section className="composer-dialog">
            <div className="dialog-header">
              <div><span className="dialog-icon"><Sparkles size={17} /></span><div><h2 id="composer-title">Create slides</h2></div></div>
              <button type="button" onClick={() => setComposeOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="mode-tabs">
              <button aria-pressed={composeMode === "text"} className={composeMode === "text" ? "active" : ""} type="button" onClick={() => setComposeMode("text")}>Paste text</button>
              <button aria-pressed={composeMode === "json"} className={composeMode === "json" ? "active" : ""} type="button" onClick={() => setComposeMode("json")}>JSON config</button>
            </div>
            {composeMode === "text" ? (
              <div className="composer-body">
                <label htmlFor="source-text">Source text</label>
                <textarea ref={sourceRef} id="source-text" rows={12} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste an article, notes, or a rough idea. Separate sections with blank lines for more control…" />
                <p>Vertica turns each paragraph into a slide. You can edit every word afterward.</p>
              </div>
            ) : (
              <div className="composer-body">
                <div className="json-label"><label htmlFor="json-config">Carousel config</label><button type="button" onClick={copyAiPrompt}><Copy size={13} /> Copy AI prompt</button></div>
                <textarea ref={sourceRef} className="json-editor" id="json-config" rows={15} value={jsonText} onChange={(event) => setJsonText(event.target.value)} spellCheck={false} />
                <p>Ask Claude or Codex to return this shape, then paste the result here.</p>
              </div>
            )}
            {composeMessage && <p className={`composer-message ${composeMessage.kind}`} role="status">{composeMessage.message}</p>}
            <div className="dialog-footer"><button className="secondary-button" type="button" onClick={() => setComposeOpen(false)}>Cancel</button><button className="primary-button" type="button" onClick={applyComposer}><Sparkles size={15} /> {composeMode === "text" ? "Create slides" : "Apply config"}</button></div>
          </section>
        </Dialog>
      )}

      {readerOpen && <ReaderPreview config={config} initialIndex={selectedIndex} onClose={() => setReaderOpen(false)} />}

      {mediaOpen && <MediaPicker onChoose={chooseMedia} onClose={() => setMediaOpen(null)} />}
      {videoOpen && <VideoPicker onChoose={(video) => {
        updateSlide({ background: undefined, video: { key: video.key, start: 0, duration: Math.min(10, Math.floor(video.duration * 10) / 10), sourceDuration: video.duration } });
        setVideoPlaying(true);
      }} onClose={() => setVideoOpen(false)} />}

      {notice && <div className={`toast ${notice.kind}`} role="status">{notice.kind === "success" ? <Check size={16} /> : <X size={16} />}{notice.message}</div>}
    </main>
  );
}
