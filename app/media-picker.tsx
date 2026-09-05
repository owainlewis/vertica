import { ChevronDown, Check, Images, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listMedia, type MediaAsset } from "./api-client";
import Dialog from "./dialog";
import { prepareImages } from "./image-upload";
import { SUPPORTED_IMAGE_ACCEPT } from "./image-formats";
import BusyLabel from "./busy-label";
import { mediaUrl, putImage } from "./image-store";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let live = true;
    liveRef.current = true;
    listMedia()
      .then((page) => { if (live) { setMedia(page.media); setNextCursor(page.nextCursor); } })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Could not load your media."); });
    return () => { live = false; liveRef.current = false; };
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const [image] = await prepareImages([file]);
      if (!image) throw new Error("Choose a PNG, JPEG, GIF, AVIF, or WebP image.");
      const key = await putImage(image.dataUrl, image);
      if (!liveRef.current) return;
      const asset: MediaAsset = { key, name: image.name, width: image.width, height: image.height, kind: "image", mimeType: "image/webp", byteSize: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      setMedia((current) => [asset, ...(current ?? []).filter((item) => item.key !== key)]);
      await choose(asset);
    } catch (cause) {
      if (liveRef.current) setError(cause instanceof Error ? cause.message : "Could not upload that image. Try again.");
    } finally {
      if (liveRef.current) {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    }
  }

  async function choose(asset: MediaAsset) {
    setChoosing(asset.key);
    setError(null);
    try {
      await onChoose(asset);
      onClose();
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
      setMedia((current) => {
        const keys = new Set((current ?? []).map((asset) => asset.key));
        return [...(current ?? []), ...page.media.filter((asset) => !keys.has(asset.key))];
      });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more media.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Dialog labelId="media-picker-title" onDismiss={() => { if (!choosing) onClose(); }}>
      <section className="composer-dialog media-picker">
        <div className="dialog-header">
          <div><span className="dialog-icon"><Images size={17} /></span><div><h2 id="media-picker-title">Choose an image</h2></div></div>
          <button type="button" disabled={choosing !== null} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="picker-upload">
          <input ref={inputRef} type="file" hidden accept={SUPPORTED_IMAGE_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          <button className="secondary-button" type="button" disabled={uploading || choosing !== null || (media === null && !error)} aria-busy={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}<BusyLabel busy={uploading} idle="Upload image" pending="Uploading…" />
          </button>
        </div>
        <div className="media-picker-body">
          {error && <p className="dashboard-error" role="status">{error}</p>}
          {media === null && !error && <div className="picker-loading" role="status"><LoaderCircle className="spin" size={20} /> Loading media…</div>}
          {media?.length === 0 && (
            <div className="picker-empty"><Images size={24} /><strong>Your media library is empty</strong><span>Upload an image to use it here.</span></div>
          )}
          <div className="media-picker-grid">
            {(media ?? []).map((asset) => (
              <button type="button" key={asset.key} onClick={() => { void choose(asset); }} disabled={choosing !== null || uploading} aria-label={`Use ${asset.name}`}>
                <img src={mediaUrl(asset.key)} alt="" loading="lazy" />
                <span>{asset.name}</span>
                {choosing === asset.key && <i><LoaderCircle className="spin" size={15} /></i>}
                {choosing !== null && choosing !== asset.key ? null : choosing === null ? <i className="picker-check"><Check size={14} /></i> : null}
              </button>
            ))}
          </div>
          {nextCursor && (
            <button className="secondary-button media-load-more" type="button" onClick={() => { void loadMore(); }} disabled={loadingMore} aria-busy={loadingMore}>
              {loadingMore ? <LoaderCircle className="spin" size={16} /> : <ChevronDown size={16} />}<BusyLabel busy={loadingMore} idle="Load more images" pending="Loading…" />
            </button>
          )}
        </div>
        <div className="dialog-footer"><button className="secondary-button" type="button" disabled={choosing !== null} onClick={onClose}>Cancel</button></div>
      </section>
    </Dialog>
  );
}
