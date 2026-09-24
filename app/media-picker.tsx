import { Check, Images, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listMedia, type MediaAsset } from "./api-client";
import BusyLabel from "./busy-label";
import Dialog from "./dialog";
import { SUPPORTED_IMAGE_ACCEPT } from "./image-formats";
import { mediaUrl, putImage } from "./image-store";
import { prepareImages } from "./image-upload";

export default function MediaPicker({
  onChoose,
  onClose,
}: {
  onChoose: (asset: MediaAsset) => Promise<void>;
  onClose: () => void;
}) {
  const [media, setMedia] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Uploads outlive a closed dialog; nothing may touch state after unmount.
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    listMedia()
      .then((assets) => { if (live.current) setMedia(assets); })
      .catch((cause) => { if (live.current) setError(cause instanceof Error ? cause.message : "Could not load your media."); });
    return () => { live.current = false; };
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const [image] = await prepareImages([file]);
      if (!image) throw new Error("Choose a PNG, JPEG, GIF, AVIF, or WebP image.");
      const key = await putImage(image.dataUrl, image);
      if (!live.current) return;
      const now = new Date().toISOString();
      const asset: MediaAsset = { key, name: image.name, width: image.width, height: image.height, kind: "image", mimeType: "image/webp", byteSize: null, createdAt: now, updatedAt: now };
      setMedia((current) => [asset, ...(current ?? []).filter((item) => item.key !== key)]);
      await choose(asset);
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : "Could not upload that image. Try again.");
    } finally {
      if (live.current) {
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

  const busy = uploading || choosing !== null;

  return (
    <Dialog labelId="media-picker-title" onDismiss={() => { if (!choosing) onClose(); }}>
      <section className="composer-dialog media-picker">
        <div className="dialog-header">
          <div><span className="dialog-icon"><Images size={17} /></span><div><h2 id="media-picker-title">Choose an image</h2></div></div>
          <button type="button" disabled={choosing !== null} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="picker-upload">
          <input ref={inputRef} type="file" hidden accept={SUPPORTED_IMAGE_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          <button className="secondary-button" type="button" disabled={busy || (media === null && !error)} aria-busy={uploading} onClick={() => inputRef.current?.click()}>
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
              <button type="button" key={asset.key} onClick={() => { void choose(asset); }} disabled={busy} aria-label={`Use ${asset.name}`}>
                <img src={mediaUrl(asset.key)} alt="" loading="lazy" />
                <span>{asset.name}</span>
                {choosing === asset.key && <i><LoaderCircle className="spin" size={15} /></i>}
                {choosing === null && <i className="picker-check"><Check size={14} /></i>}
              </button>
            ))}
          </div>
        </div>
        <div className="dialog-footer"><button className="secondary-button" type="button" disabled={choosing !== null} onClick={onClose}>Cancel</button></div>
      </section>
    </Dialog>
  );
}
