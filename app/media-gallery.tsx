import { Button } from "./components/ui/button";
import { ChevronDown, ImagePlus, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteMedia, listMedia, type MediaAsset } from "./api-client";
import BusyLabel from "./busy-label";
import { SUPPORTED_IMAGE_ACCEPT } from "./image-formats";
import { mediaUrl, putImage } from "./image-store";
import { prepareImages } from "./image-upload";

function imageDetails(asset: MediaAsset) {
  if (asset.width && asset.height) return `${asset.width} × ${asset.height}`;
  return "Dimensions unavailable";
}

export default function MediaGallery() {
  const [media, setMedia] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const page = await listMedia();
      setMedia(page.media);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your media.");
    }
  }, []);

  useEffect(() => {
    let live = true;
    listMedia()
      .then((page) => { if (live) { setMedia(page.media); setNextCursor(page.nextCursor); } })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Could not load your media."); });
    return () => { live = false; };
  }, []);

  async function upload(files: FileList | File[]) {
    if (!files.length || uploading) return;
    setUploading(true);
    setUploadCount(0);
    setError(null);
    let completed = 0;
    try {
      const selected = Array.from(files);
      for (let start = 0; start < selected.length; start += 3) {
        // Decode, resize, and upload one small batch before allocating the next.
        const prepared = await prepareImages(selected.slice(start, start + 3));
        const results = await Promise.allSettled(prepared.map((image) => putImage(image.dataUrl, {
          name: image.name,
          width: image.width,
          height: image.height,
        })));
        completed += results.filter((result) => result.status === "fulfilled").length;
        setUploadCount(completed);
        const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) throw failed.reason;
      }
      await refresh();
      if (!completed) setError("Choose PNG, JPEG, GIF, AVIF, or WebP images.");
    } catch (cause) {
      // Earlier batches are already durable. Show them even when a later one fails.
      if (completed) await refresh().catch(() => undefined);
      setError(cause instanceof Error ? cause.message : "Could not upload those images.");
    } finally {
      setUploading(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listMedia(nextCursor);
      setMedia((current) => {
        const existing = new Set((current ?? []).map((item) => item.key));
        return [...(current ?? []), ...page.media.filter((item) => !existing.has(item.key))];
      });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more media.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove(asset: MediaAsset) {
    setBusyKey(asset.key);
    setError(null);
    try {
      await deleteMedia(asset.key);
      setMedia((current) => (current ?? []).filter((item) => item.key !== asset.key));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that image.");
    } finally {
      setBusyKey(null);
      setConfirmKey(null);
    }
  }

  return (
    <main className="dashboard media-page">
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept={SUPPORTED_IMAGE_ACCEPT}
        multiple
        onChange={(event) => { if (event.target.files) void upload(event.target.files); }}
      />

      <section className="dashboard-body">
        <div className="dashboard-heading">
          <h1>Media library</h1>
          <Button className="export-button" type="button" onClick={() => inputRef.current?.click()} disabled={uploading} aria-busy={uploading}>
            {uploading ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}
            <BusyLabel busy={uploading} idle="Upload images" pending="Uploading…" />
          </Button>
        </div>


        {error && <p className="dashboard-error" role="status">{error}</p>}

        <div
          className={`media-dropzone ${dragging ? "dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void upload(event.dataTransfer.files);
          }}
        >
          <ImagePlus size={19} />
          <span><strong role="status">{uploading ? `Uploading… ${uploadCount} completed` : "Drop images here"}</strong><small>They are resized for carousel backgrounds and stored in your library.</small></span>
          <Button variant="outline" className="secondary-button" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>Choose files</Button>
        </div>

        {media === null && !error && <div className="library-loading" role="status"><LoaderCircle className="spin" size={20} /> Loading images…</div>}

        <ul className="media-grid">
          {(media ?? []).map((asset) => (
            <li className="media-card" key={asset.key}>
              <img src={mediaUrl(asset.key)} alt={asset.name} loading="lazy" onLoad={(event) => {
                if (asset.width && asset.height) return;
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                if (width && height) setMedia((current) => current?.map((item) => item.key === asset.key ? { ...item, width, height } : item) ?? null);
              }} />
              <div className="media-card-meta">
                <span><strong>{asset.name}</strong><small>{imageDetails(asset)}</small></span>
                {confirmKey === asset.key ? (
                  <span className="media-confirm">
                    <button type="button" className="danger-action" onClick={() => { void remove(asset); }} disabled={busyKey === asset.key} aria-busy={busyKey === asset.key}>
                      <BusyLabel busy={busyKey === asset.key} idle="Delete" pending="Deleting…" />
                    </button>
                    <button type="button" onClick={() => setConfirmKey(null)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" className="media-delete" onClick={() => setConfirmKey(asset.key)} aria-label={`Delete ${asset.name}`}><Trash2 size={14} /></button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {nextCursor && (
          <Button variant="outline" className="secondary-button media-load-more" type="button" onClick={() => { void loadMore(); }} disabled={loadingMore} aria-busy={loadingMore}>
            {loadingMore ? <LoaderCircle className="spin" size={16} /> : <ChevronDown size={16} />}<BusyLabel busy={loadingMore} idle="Load more images" pending="Loading…" />
          </Button>
        )}
      </section>
    </main>
  );
}
