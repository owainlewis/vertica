import { ArrowUpRight, Copy, Download, Images, Layers, LoaderCircle, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  deleteCarousel,
  saveCarousel,
  resolveMedia,
  listCarousels,
  loadCarousel,
  type CarouselSummary,
} from "./api-client";
import { assertBackgroundsAvailableForExport, carouselTheme, CarouselConfig, CarouselSlide, duplicateCarouselConfig, normalizeSlideLayout } from "./carousel";
import { exportStageToPdf, exportStageToZip, fileNameFor } from "./export";
import { loadImages } from "./image-store";
import { ExportStage, Slide } from "./slide";

/** A row written before the cover format settled must not break the whole list. */
function readCover(cover: string) {
  try {
    return JSON.parse(cover || "{}") as {
      slide?: Partial<CarouselSlide>;
      mark?: string;
      theme?: string;
    };
  } catch {
    return {};
  }
}

function relativeDate(iso: string) {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The card shows the real first slide, not a lookalike. Every size on a slide is in
 * cqw against the slide itself, so rendering one in a narrow box is an exact
 * miniature — no separate preview styling to drift out of step with the editor.
 */
function CardPreview({
  carousel,
  images,
}: {
  carousel: CarouselSummary;
  /** Resolved media keys, so the card paints what the editor paints. */
  images: Record<string, string>;
}) {
  const config = useMemo<CarouselConfig>(() => {
    const stored = readCover(carousel.cover);
    const resolve = (ref: string | undefined) => (ref && images[ref]) || ref;
    const parsed = stored.slide ?? {};
    const cover: CarouselSlide = normalizeSlideLayout({
      ...parsed,
      id: parsed.id ?? "cover",
      layout: parsed.layout ?? "cover",
      title: parsed.title ?? (carousel.coverTitle || carousel.title),
      body: parsed.body ?? "",
      ...(parsed.background ? { background: resolve(parsed.background) } : {}),
      ...(parsed.images ? { images: parsed.images.map((ref) => resolve(ref) ?? ref) } : {}),
    }, "cover");
    // The footer counter reads off the deck length, so the card needs the real count.
    return {
      version: 1,
      title: carousel.title,
      author: carousel.author,
      theme: carouselTheme(stored.theme),
      ...(stored.mark ? { mark: stored.mark } : {}),
      slides: Array.from({ length: Math.max(carousel.slideCount, 1) }, () => cover),
    };
  }, [carousel, images]);

  return (
    <span className="card-preview">
      <Slide slide={config.slides[0]} config={config} index={0} />
    </span>
  );
}

export default function Dashboard({
  onOpen,
  onCreate,
  reloadToken,
}: {
  onOpen: (id: string) => void;
  onCreate: () => void;
  reloadToken: number;
}) {
  const [carousels, setCarousels] = useState<CarouselSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const [visibleCount, setVisibleCount] = useState(24);
  const visibleCarousels = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (carousels ?? [])
      .filter((carousel) => carousel.title.toLocaleLowerCase().includes(search))
      .sort((a, b) => sort === "title"
        ? a.title.localeCompare(b.title)
        : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [carousels, query, sort]);
  const pageCarousels = useMemo(() => visibleCarousels.slice(0, visibleCount), [visibleCarousels, visibleCount]);
  // Downloading needs the slides on the page, so the chosen deck is mounted
  // offscreen and rasterised once React has painted it.
  const [pending, setPending] = useState<{ config: CarouselConfig; title: string; kind: "pdf" | "zip" } | null>(null);
  // Cover media is loaded from the durable media store once the list arrives.
  const [covers, setCovers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    let live = true;
    listCarousels()
      .then((rows) => live && setCarousels(rows))
      .catch((cause) => live && setError(cause instanceof Error ? cause.message : "Could not load your carousels."));
    return () => { live = false; };
  }, [reloadToken]);

  useEffect(() => {
    if (!pageCarousels.length) return;
    let live = true;
    const keys = pageCarousels.flatMap((row) => {
      const stored = readCover(row.cover);
      return [stored.slide?.background ?? "", ...(stored.slide?.images ?? [])];
    }).filter(Boolean);
    loadImages([...new Set(keys)]).then((images) => {
      if (live) setCovers(images);
    });
    return () => { live = false; };
  }, [pageCarousels]);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    // One frame so the offscreen stage is in the DOM before it is read.
    const timer = window.setTimeout(async () => {
      try {
        if (pending.kind === "pdf") await exportStageToPdf(fileNameFor(pending.title), pending.config.slides.length);
        else await exportStageToZip(fileNameFor(pending.title, "zip"), pending.config.slides.length);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "The download failed.");
      } finally {
        if (live) { setPending(null); setBusyId(null); }
      }
    }, 50);
    return () => { live = false; window.clearTimeout(timer); };
  }, [pending]);

  async function download(carousel: CarouselSummary, kind: "pdf" | "zip") {
    setBusyId(carousel.id);
    setError(null);
    try {
      const { config } = await loadCarousel(carousel.id);
      const painted = await resolveMedia(config);
      assertBackgroundsAvailableForExport(painted);
      setPending({ config: painted, title: config.title, kind });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that carousel.");
      setBusyId(null);
    }
  }

  async function duplicate(carousel: CarouselSummary) {
    if (busyId) return;
    setBusyId(carousel.id);
    setDuplicatingId(carousel.id);
    setError(null);
    setMessage(null);
    try {
      const { config } = await loadCarousel(carousel.id);
      const copy = await saveCarousel(null, duplicateCarouselConfig(config), null);
      setCarousels((current) => [copy, ...(current ?? [])]);
      setMessage(`Created ${copy.title}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not duplicate that carousel. Try again.");
    } finally {
      setBusyId(null);
      setDuplicatingId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await deleteCarousel(id);
      setCarousels((current) => (current ?? []).filter((row) => row.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that carousel.");
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  return (
    <main className="dashboard">
      <section className="dashboard-body">
        <div className="dashboard-heading">
          <h1>Your carousels</h1>
          <button className="export-button" type="button" onClick={onCreate}><Plus size={18} /> New carousel</button>
        </div>

        <div className="library-toolbar">
          <div className="library-filters">
            <label className="library-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search carousels" placeholder="Search carousels…" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(24); }} />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</label>
            <select aria-label="Sort carousels" value={sort} onChange={(event) => { setSort(event.target.value); setVisibleCount(24); }}><option value="updated">Last edited</option><option value="title">Name A–Z</option></select>
          </div>
        </div>

        {message && <div className="toast" role="status">{message}</div>}
        {error && <p className="dashboard-error" role="status">{error}</p>}

        {carousels !== null && carousels.length === 0 && !error && (
          <div className="empty-state">
            <Layers size={36} strokeWidth={1.2} aria-hidden="true" />
            <h2>Nothing saved yet</h2>
            <button className="export-button" type="button" onClick={onCreate}><Plus size={15} /> New carousel</button>
          </div>
        )}

        {carousels === null && !error && <div className="library-loading" role="status"><LoaderCircle className="spin" size={20} /> Loading your library…</div>}
        {carousels !== null && carousels.length > 0 && visibleCarousels.length === 0 && (
          <div className="empty-state"><Search size={28} aria-hidden="true" /><h2>No matching carousels</h2><p>Try another title or clear your search to see every deck.</p><button className="secondary-button" type="button" onClick={() => setQuery("")}>Clear search</button></div>
        )}

        <ul className="gallery">
          {pageCarousels.map((carousel) => (
            <li className="gallery-card" key={carousel.id}>
              <button className="card-open" type="button" onClick={() => onOpen(carousel.id)} aria-label={`Open ${carousel.title}`}>
                <CardPreview carousel={carousel} images={covers} />
                <span className="card-open-hint">Open carousel <ArrowUpRight size={16} /></span>
              </button>
              <div className="card-overlay">
                <span className="card-meta">
                  <strong title={carousel.title}>{carousel.title}</strong>
                  <small>{carousel.slideCount} slide{carousel.slideCount === 1 ? "" : "s"} · edited {relativeDate(carousel.updatedAt)}</small>
                </span>
                <div className="card-actions">
                <button type="button" onClick={() => download(carousel, "pdf")} disabled={busyId !== null} aria-label={`Download ${carousel.title} as PDF`}>
                  {busyId === carousel.id && pending?.kind === "pdf" ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
                  PDF
                </button>
                <button type="button" onClick={() => download(carousel, "zip")} disabled={busyId !== null} aria-label={`Download ${carousel.title} as JPEGs`} title="Numbered JPEGs, zipped, for Instagram">
                  {busyId === carousel.id && pending?.kind === "zip" ? <LoaderCircle className="spin" size={14} /> : <Images size={14} />}
                  JPEGs
                </button>
                <button type="button" disabled={busyId !== null} aria-busy={duplicatingId === carousel.id} onClick={() => { void duplicate(carousel); }} aria-label={`Duplicate ${carousel.title}`} title="Duplicate carousel">
                  {duplicatingId === carousel.id ? <LoaderCircle className="spin" size={14} /> : <Copy size={14} />}
                </button>
                <button className="danger-action" type="button" disabled={busyId !== null} onClick={() => setConfirmId(carousel.id)} aria-label={`Delete ${carousel.title}`}>
                  <Trash2 size={14} />
                </button>
                {confirmId === carousel.id && (
                  <span className="confirm-delete">
                    <button className="danger-action" type="button" disabled={busyId !== null} onClick={() => remove(carousel.id)}>Delete</button>
                    <button type="button" onClick={() => setConfirmId(null)}>Keep</button>
                  </span>
                )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {visibleCount < visibleCarousels.length && (
          <button className="secondary-button media-load-more" type="button" onClick={() => setVisibleCount((count) => count + 24)}>
            Load more carousels ({visibleCarousels.length - visibleCount} remaining)
          </button>
        )}
      </section>

      {pending && <ExportStage config={pending.config} />}
    </main>
  );
}
