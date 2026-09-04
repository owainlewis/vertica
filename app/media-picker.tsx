import { Check, Images, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listMedia, type MediaAsset } from "./api-client";
import { mediaUrl } from "./image-store";

export default function MediaPicker({
  onChoose,
  onClose,
}: {
  onChoose: (asset: MediaAsset) => Promise<void>;
  onClose: () => void;
}) {
  const [media, setMedia] = useState<MediaAsset[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    listMedia()
      .then((page) => { if (live) { setMedia(page.media); setNextCursor(page.nextCursor); } })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Could not load your media."); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
  }, []);

  async function choose(asset: MediaAsset) {
    setChoosing(asset.key);
    setError(null);
    try {
      await onChoose(asset);
      dialogRef.current?.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not use that image.");
      setChoosing(null);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listMedia(nextCursor);
      setMedia((current) => [...(current ?? []), ...page.media]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more media.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="native-dialog"
      aria-labelledby="media-picker-title"
      onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }}
      onClose={onClose}
    >
      <section className="composer-dialog media-picker">
        <div className="dialog-header">
          <div><span className="dialog-icon"><Images size={17} /></span><div><h2 id="media-picker-title">Choose from media</h2><p>Reuse an image from your library on this slide.</p></div></div>
          <button ref={closeRef} type="button" onClick={() => dialogRef.current?.close()} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="media-picker-body">
          {error && <p className="dashboard-error" role="status">{error}</p>}
          {media === null && !error && <div className="picker-loading"><LoaderCircle className="spin" size={20} /> Loading media…</div>}
          {media?.length === 0 && (
            <div className="picker-empty"><Images size={24} /><strong>Your media library is empty</strong><span>Return to the dashboard, open Media, and upload your images there.</span></div>
          )}
          <div className="media-picker-grid">
            {(media ?? []).map((asset) => (
              <button type="button" key={asset.key} onClick={() => { void choose(asset); }} disabled={choosing !== null} aria-label={`Use ${asset.name}`}>
                <img src={mediaUrl(asset.key)} alt="" loading="lazy" />
                <span>{asset.name}</span>
                {choosing === asset.key && <i><LoaderCircle className="spin" size={15} /></i>}
                {choosing !== null && choosing !== asset.key ? null : choosing === null ? <i className="picker-check"><Check size={14} /></i> : null}
              </button>
            ))}
          </div>
          {nextCursor && (
            <button className="secondary-button media-load-more" type="button" onClick={() => { void loadMore(); }} disabled={loadingMore}>
              {loadingMore ? <LoaderCircle className="spin" size={14} /> : null}{loadingMore ? "Loading…" : "Load more images"}
            </button>
          )}
        </div>
        <div className="dialog-footer"><button className="secondary-button" type="button" onClick={() => dialogRef.current?.close()}>Cancel</button></div>
      </section>
    </dialog>
  );
}
