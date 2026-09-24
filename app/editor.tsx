import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Eye,
  Pause,
  Play,
  Plus,
  RectangleVertical,
  Redo2,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { saveCarousel, StaleSaveError, type CarouselSummary, type MediaAsset } from "./api-client";
import {
  assertBackgroundsAvailableForExport,
  slideTypeface,
  type CarouselConfig,
  type CarouselSlide,
  carouselTheme,
  imageCapacity,
  MAX_SLIDES,
  newSlideId,
  titleLines,
} from "./carousel";
import Composer, { type ComposerMode } from "./composer";
import { downloadBlob, exportStageToMp4, exportStageToPdf, exportStageToZip, exportStageToVideoZip, exportStageToReel, fileNameFor } from "./export";
import ExportMenu, { type ExportKind } from "./export-menu";
import { loadImages } from "./image-store";
import Inspector, { layoutNames } from "./inspector";
import MediaPicker from "./media-picker";
import ReaderPreview from "./reader-preview";
import { SaveQueue } from "./save-queue";
import { ExportStage, Slide } from "./slide";
import { slideHasOverflow } from "./slide-overflow";
import { useHistory } from "./use-history";
import { boundVideoBackground, parseVideoBackground } from "./video-formats";
import VideoPicker from "./video-picker";

type Notice = { kind: "success" | "error"; message: string } | null;

/** What the shell can ask of an open editor: finish saving before leaving it. */
export type EditorHandle = { flush: () => Promise<boolean>; isDirty: () => boolean };

const SAVE_LABEL = {
  saved: "Saved",
  dirty: "Unsaved",
  saving: "Saving…",
  error: "Not saved",
  stale: "Out of date",
} as const;

/** Edits settle for this long before an autosave is attempted. */
const AUTOSAVE_MS = 1200;
const NOTICE_MS = 3200;

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

function plainTitle(slide: CarouselSlide) {
  return titleLines(slide.title.trim() || slide.body.trim().split("\n")[0] || slide.label || "Untitled slide").join(" ").replace(/\*/g, "");
}

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
  const [exporting, setExporting] = useState<false | ExportKind>(false);
  const [exportProgress, setExportProgress] = useState("");
  // Every change to the deck goes through `commit` so it can be undone. Export
  // freezes the deck so the mounted stage cannot change under the rasteriser.
  const { value: config, setValue: setConfig, commit, step, canUndo, canRedo } = useHistory(initialConfig, Boolean(exporting));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showCrop, setShowCrop] = useState(false);
  const [composer, setComposer] = useState<ComposerMode | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [readerOpen, setReaderOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState<MediaTarget | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [copyOverflow, setCopyOverflow] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [saveState, setSaveState] = useState<keyof typeof SAVE_LABEL>("saved");
  const [exiting, setExiting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

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
      if (mounted.current) onSavedRef.current(summary);
      return summary;
    });
    saveQueueRef.current = queue;
    return () => { saveQueueRef.current = null; };
  }, []);

  const selectedSlide = config.slides[selectedIndex] ?? config.slides[0];
  const signifierMissing = useSignifierCheck();
  const theme = carouselTheme(config.theme);
  const anyDialogOpen = composer !== null || mediaOpen !== null || videoOpen || readerOpen;

  useEffect(() => {
    let active = true;
    const check = () => {
      if (active) setCopyOverflow(slideHasOverflow(previewRef.current?.querySelector("article") ?? null));
    };
    const timer = setTimeout(check, 0);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    if (previewRef.current) observer?.observe(previewRef.current);
    void document.fonts?.ready.then(check);
    return () => { active = false; clearTimeout(timer); observer?.disconnect(); };
  }, [selectedSlide, config]);
  const exportFileName = useMemo(() => fileNameFor(config.title), [config.title]);

  function showNotice(next: Notice) {
    setNotice(next);
    window.setTimeout(() => setNotice(null), NOTICE_MS);
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

  useImperativeHandle(ref, () => ({
    flush: () => exporting ? Promise.resolve(false) : flushSave(),
    isDirty: () => Boolean(exporting) || (saveQueueRef.current?.dirty ?? false),
  }), [flushSave, exporting]);

  const undoRedo = useCallback((from: "past" | "future") => {
    const restored = step(from);
    // A slide the undone step had added may no longer be there to select.
    if (restored) setSelectedIndex((index) => Math.min(index, restored.slides.length - 1));
  }, [step]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Modal text fields own their native undo history, not the deck history.
      if (anyDialogOpen) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      undoRedo(event.shiftKey ? "future" : "past");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoRedo, anyDialogOpen]);

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

    const timer = window.setTimeout(() => { void flushSave(); }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [config, flushSave]);

  // Refreshing or closing cannot reliably finish an async request, so the browser
  // warns instead of silently discarding a queued or in-flight edit.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leavingRef.current || (!exporting && !saveQueueRef.current?.dirty)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [exporting]);

  /** Patch the selected slide. `key` groups a burst of edits into one undo step. */
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
    if (config.slides.length >= MAX_SLIDES) return;
    const slide: CarouselSlide = {
      id: newSlideId(),
      layout: "content",
      typeface: slideTypeface(selectedSlide, config.theme),
      title: "Add a clear headline",
      body: "Use one thought per slide. Keep the supporting copy short.",
    };
    commit({ ...config, slides: [...config.slides, slide] });
    setSelectedIndex(config.slides.length);
  }

  function duplicateSlide() {
    if (config.slides.length >= MAX_SLIDES) return;
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
      const room = imageCapacity(selectedSlide) - images.length;
      showNotice({ kind: "success", message: room > 0 ? `Added ${asset.name}. Room for ${room} more.` : `Added ${asset.name}.` });
      return;
    }
    updateSlide({ background: data, video: undefined });
    showNotice({ kind: "success", message: `${asset.name} is now the slide background.` });
  }

  /** Source metadata is derived, so refreshing it must not add an undo step. */
  function adoptVideoDuration(duration: number) {
    if (exporting) return;
    setConfig((current) => {
      const slide = current.slides.find((item) => item.id === selectedSlide.id);
      if (!slide?.video || slide.video.key !== selectedSlide.video?.key) return current;
      const video = boundVideoBackground(slide.video, duration);
      if (video.sourceDuration === slide.video.sourceDuration && video.start === slide.video.start && video.duration === slide.video.duration) return current;
      return { ...current, slides: current.slides.map((item) => item === slide ? { ...slide, video } : item) };
    });
  }

  function applyComposer(next: CarouselConfig) {
    // Through commit, so replacing a whole deck by mistake is undoable.
    commit(next);
    setSelectedIndex(0);
    setComposer(null);
    showNotice({ kind: "success", message: `Created ${next.slides.length} slides. They are ready to edit.` });
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    downloadBlob(blob, exportFileName.replace(/\.pdf$/, ".json"));
  }

  async function requestExit() {
    if (exiting || exporting) return;
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

  async function runExport(kind: ExportKind) {
    if (exporting) return;
    setNotice(null);
    setExporting(kind);
    try {
      assertBackgroundsAvailableForExport(kind === "mp4" ? { ...config, slides: [selectedSlide] } : config);
      if (kind === "mp4") {
        if (!selectedSlide.video) throw new Error("Choose a slide with a video background.");
        if (!selectedSlide.video.sourceDuration) throw new Error("Wait for the video to load before exporting.");
        parseVideoBackground(selectedSlide.video);
        const page = String(selectedIndex + 1).padStart(2, "0");
        await exportStageToMp4(fileNameFor(`${config.title}-${page}`, "mp4"), config.slides.length, selectedIndex, selectedSlide.video);
        showNotice({ kind: "success", message: `Exported slide ${selectedIndex + 1} as an MP4.` });
      } else if (kind === "video-zip") {
        await exportStageToVideoZip(fileNameFor(config.title, "zip"), config, setExportProgress);
        showNotice({ kind: "success", message: `Exported ${config.slides.length} numbered MP4s for Instagram.` });
      } else if (kind === "reel") {
        await exportStageToReel(fileNameFor(config.title, "mp4"), config, setExportProgress);
        showNotice({ kind: "success", message: "Exported all slides as one MP4." });
      } else if (kind === "pdf") {
        await exportStageToPdf(exportFileName, config.slides.length);
        showNotice({ kind: "success", message: `Exported ${config.slides.length} PDF pages for LinkedIn.` });
      } else {
        await exportStageToZip(fileNameFor(config.title, "zip"), config.slides.length);
        showNotice({ kind: "success", message: `Exported ${config.slides.length} numbered JPEGs for Instagram.` });
      }
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "The export failed." });
    } finally {
      setExporting(false);
      setExportProgress("");
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
          <button className="secondary-button icon-button" type="button" onClick={() => undoRedo("past")} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo"><Undo2 size={15} /></button>
          <button className="secondary-button icon-button" type="button" onClick={() => undoRedo("future")} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 size={15} /></button>
          <button className="secondary-button generate-button" type="button" onClick={() => setComposer("text")} aria-label="Create from text" title="Create from text"><Sparkles size={15} /> <span>Create from text</span></button>
          <button className="secondary-button icon-button" type="button" onClick={() => setReaderOpen(true)} aria-label="Reader preview" title="Reader preview"><Eye size={16} /></button>
          <ExportMenu busy={Boolean(exporting)} video={Boolean(selectedSlide.video)} videoCarousel={config.format === "video" || config.slides.every((slide) => Boolean(slide.video))} onExport={(kind) => { void runExport(kind); }} />
        </div>
      </header>

      {exporting && <p className="video-export-status" role="status">{exportProgress || (exporting === "mp4" ? "Rendering MP4… This may take a minute." : "Exporting slides…")} Keep this tab open.</p>}
      <section className="workspace" inert={Boolean(exporting)}>
        <aside className="rail">
          <div className="rail-heading"><span>Slides</span><button type="button" onClick={addSlide} disabled={config.slides.length >= MAX_SLIDES} aria-label="Add slide"><Plus size={15} /></button></div>
          <div className="slide-list">
            {config.slides.map((slide, index) => (
              <button className={`slide-thumb ${index === selectedIndex ? "selected" : ""}`} type="button" key={slide.id} onClick={() => setSelectedIndex(index)} aria-pressed={index === selectedIndex} aria-label={`Slide ${index + 1}: ${plainTitle(slide)}`}>
                <span className="thumb-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="thumb-frame" aria-hidden="true"><Slide slide={slide} config={config} index={index} /></span>
                <span className="thumb-label">
                  <strong>{plainTitle(slide)}</strong>
                  <small>{layoutNames[slide.layout]}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-area" aria-label="Slide preview">
          {signifierMissing && slideTypeface(selectedSlide, config.theme) === "serif" && (
            <p className="font-warning" role="status">
              Signifier is not installed on this machine, so slides are showing Georgia. Exports from here will ship Georgia too. Install Signifier or export from a machine that has it.
            </p>
          )}
          <div className="canvas-toolbar">
            <span>{config.format === "video" ? "Video carousel" : "Image carousel"} · 4:5</span>
            <button className="crop-toggle" type="button" aria-pressed={showCrop} onClick={() => setShowCrop(!showCrop)} title="Centered 3:4 profile crop; the exported slide stays 4:5">
              <RectangleVertical size={13} /> Profile crop
            </button>
            <span>{selectedIndex + 1} of {config.slides.length}</span>
          </div>
          <div className="preview-frame" ref={previewRef}>
            <Slide slide={selectedSlide} config={config} index={selectedIndex} videoPreview playing={videoPlaying && !readerOpen} onVideoDuration={adoptVideoDuration} />
            {showCrop && <div className="crop-guide" />}
          </div>
          {copyOverflow && <p className="slide-overflow-warning" role="status">Some text overlaps or runs outside the slide. Shorten the copy, remove forced line breaks, or choose another position before exporting.</p>}
          <div className="slide-actions" aria-label="Slide actions">
            {selectedSlide.video && <button type="button" onClick={() => setVideoPlaying(!videoPlaying)}>{videoPlaying ? <Pause size={14} /> : <Play size={14} />}{videoPlaying ? "Pause video" : "Play video"}</button>}
            <button type="button" onClick={() => moveSlide(-1)} disabled={selectedIndex === 0} aria-label="Move slide up"><ArrowUp size={15} /></button>
            <button type="button" onClick={() => moveSlide(1)} disabled={selectedIndex === config.slides.length - 1} aria-label="Move slide down"><ArrowDown size={15} /></button>
            <button type="button" onClick={duplicateSlide} disabled={config.slides.length >= MAX_SLIDES}><Copy size={14} /> Duplicate</button>
            <button className="danger-action" type="button" onClick={deleteSlide}><Trash2 size={14} /> Delete</button>
          </div>
        </section>

        <Inspector
          config={config}
          slide={selectedSlide}
          theme={theme}
          updateSlide={updateSlide}
          commit={commit}
          onAddPicture={() => setMediaOpen("images")}
          onChooseImage={() => setMediaOpen("background")}
          onChooseVideo={() => setVideoOpen(true)}
          onEditJson={() => setComposer("json")}
          onDownloadJson={downloadJson}
        />
      </section>

      <ExportStage config={config} />

      {composer && (
        <Composer config={config} initialMode={composer} sourceText={sourceText} onSourceText={setSourceText} onApply={applyComposer} onClose={() => setComposer(null)} />
      )}

      {readerOpen && <ReaderPreview config={config} initialIndex={selectedIndex} onClose={() => setReaderOpen(false)} />}

      {mediaOpen && <MediaPicker onChoose={chooseMedia} onClose={() => setMediaOpen(null)} />}
      {videoOpen && <VideoPicker onChoose={(video) => {
        updateSlide({ background: undefined, video: { key: video.key, start: 0, duration: Math.min(10, Math.floor(video.duration * 10) / 10), sourceDuration: video.duration, framing: selectedSlide.video?.framing ?? (video.width > video.height ? "horizontal" : "fill"), zoom: selectedSlide.video?.zoom ?? 1 } });
        setVideoPlaying(true);
      }} onClose={() => setVideoOpen(false)} />}

      {notice && <div className={`toast ${notice.kind}`} role="status">{notice.kind === "success" ? <Check size={16} /> : <X size={16} />}{notice.message}</div>}
    </main>
  );
}
