"use client";

import { Download, Images, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  deleteCarousel,
  inlineBackgrounds,
  listCarousels,
  loadCarousel,
  type CarouselSummary,
} from "./api-client";
import { assertBackgroundsAvailableForExport, CarouselConfig, CarouselSlide, deckTypeScale } from "./carousel";
import { exportStageToPdf, exportStageToZip, fileNameFor } from "./export";
import { loadImages } from "./image-store";
import { ExportStage, Slide } from "./slide";

/** A row written before the cover format settled must not break the whole list. */
function readCover(cover: string) {
  try {
    return JSON.parse(cover || "{}") as {
      slide?: Partial<CarouselSlide>;
      scale?: ReturnType<typeof deckTypeScale>;
      scaleVersion?: number;
      mark?: string;
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
function CardPreview({ carousel, background }: { carousel: CarouselSummary; background?: string }) {
  const { slide, scale, mark } = useMemo(() => {
    const stored = readCover(carousel.cover);
    const parsed = stored.slide ?? {};
    const cover: CarouselSlide = {
      id: parsed.id ?? "cover",
      layout: parsed.layout ?? "cover",
      title: parsed.title ?? (carousel.coverTitle || carousel.title),
      body: parsed.body ?? "",
      ...(parsed.template ? { template: parsed.template } : {}),
      ...(parsed.position ? { position: parsed.position } : {}),
      ...(parsed.align ? { align: parsed.align } : {}),
      // Carried through so the card's scrim matches the editor's rather than
      // falling back to the fixed one, which would darken the tile differently.
      ...(parsed.luma ? { luma: parsed.luma } : {}),
      ...(parsed.plate ? { plate: true } : {}),
      ...(background ? { background } : {}),
    };
    return {
      slide: cover,
      scale: stored.scaleVersion === 2 && stored.scale ? stored.scale : deckTypeScale([cover]),
      mark: stored.mark ?? "",
    };
  }, [carousel, background]);

  // The footer counter reads off the deck length, so the card needs the real count.
  const config = useMemo<CarouselConfig>(
    () => ({
      version: 1,
      title: carousel.title,
      author: carousel.author,
      template: (carousel.template as CarouselConfig["template"]) ?? "dark",
      ...(mark ? { mark } : {}),
      slides: Array.from({ length: Math.max(carousel.slideCount, 1) }, () => slide),
    }),
    [carousel, slide, mark],
  );

  return (
    <span className="card-preview">
      <Slide slide={slide} config={config} scale={scale} index={0} />
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
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Downloading needs the slides on the page, so the chosen deck is mounted
  // offscreen and rasterised once React has painted it.
  const [pending, setPending] = useState<{ config: CarouselConfig; title: string; kind: "pdf" | "zip" } | null>(null);
  // Cover backgrounds live in the browser's image store, so the cards resolve them
  // separately once the list arrives.
  const [covers, setCovers] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    listCarousels()
      .then((rows) => live && setCarousels(rows))
      .catch((cause) => live && setError(cause instanceof Error ? cause.message : "Could not load your carousels."));
    return () => { live = false; };
  }, [reloadToken]);

  useEffect(() => {
    if (!carousels?.length) return;
    let live = true;
    const keys = carousels.map((row) => {
      return [row.id, readCover(row.cover).slide?.background ?? ""] as const;
    });
    loadImages(keys.map(([, key]) => key)).then((images) => {
      if (!live) return;
      setCovers(Object.fromEntries(keys.filter(([, key]) => images[key]).map(([id, key]) => [id, images[key]])));
    });
    return () => { live = false; };
  }, [carousels]);

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
      const painted = await inlineBackgrounds(config);
      assertBackgroundsAvailableForExport(painted);
      setPending({ config: painted, title: config.title, kind });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that carousel.");
      setBusyId(null);
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
      <header className="dashboard-bar">
        <span className="brand"><span className="brand-mark">V</span><span>Vertica</span></span>
        <button className="export-button" type="button" onClick={onCreate}><Plus size={15} /> New carousel</button>
      </header>

      <section className="dashboard-body">
        <div className="dashboard-heading">
          <h1>Your carousels</h1>
          <p>{carousels === null ? "Loading…" : `${carousels.length} saved`}</p>
        </div>

        {error && <p className="dashboard-error" role="status">{error}</p>}

        {carousels !== null && carousels.length === 0 && !error && (
          <div className="empty-state">
            <h2>Nothing saved yet</h2>
            <p>Make a carousel and it is kept here automatically. No files to manage.</p>
            <button className="export-button" type="button" onClick={onCreate}><Plus size={15} /> New carousel</button>
          </div>
        )}

        <ul className="gallery">
          {(carousels ?? []).map((carousel) => (
            <li className="gallery-card" key={carousel.id}>
              <button className="card-open" type="button" onClick={() => onOpen(carousel.id)} aria-label={`Open ${carousel.title}`}>
                <CardPreview carousel={carousel} background={covers[carousel.id]} />
              </button>
              <div className="card-overlay">
                <span className="card-meta">
                  <strong>{carousel.title}</strong>
                  <small>{carousel.slideCount} slide{carousel.slideCount === 1 ? "" : "s"} · edited {relativeDate(carousel.updatedAt)}</small>
                </span>
                <div className="card-actions">
                <button type="button" onClick={() => download(carousel, "pdf")} disabled={busyId === carousel.id}>
                  {busyId === carousel.id && pending?.kind === "pdf" ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
                  PDF
                </button>
                <button type="button" onClick={() => download(carousel, "zip")} disabled={busyId === carousel.id} title="Numbered JPEGs, zipped, for Instagram">
                  {busyId === carousel.id && pending?.kind === "zip" ? <LoaderCircle className="spin" size={14} /> : <Images size={14} />}
                  JPEGs
                </button>
                {confirmId === carousel.id ? (
                  <span className="confirm-delete">
                    <button className="danger-action" type="button" onClick={() => remove(carousel.id)}>Delete</button>
                    <button type="button" onClick={() => setConfirmId(null)}>Keep</button>
                  </span>
                ) : (
                  <button className="danger-action" type="button" onClick={() => setConfirmId(carousel.id)} aria-label={`Delete ${carousel.title}`}>
                    <Trash2 size={14} />
                  </button>
                )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {pending && <ExportStage config={pending.config} scale={deckTypeScale(pending.config.slides)} />}
    </main>
  );
}
