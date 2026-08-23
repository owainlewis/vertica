"use client";

import { ImagePlus, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteMedia, listMedia, type MediaAsset } from "./api-client";
import { SUPPORTED_IMAGE_ACCEPT } from "./image-formats";
import { mediaUrl, putImage } from "./image-store";
import { prepareImages } from "./image-upload";

function imageDetails(asset: MediaAsset) {
  if (asset.width && asset.height) return `${asset.width} × ${asset.height}`;
  return "Image";
}

export default function MediaGallery() {
  const [media, setMedia] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setMedia(await listMedia());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your media.");
    }
  }, []);

  useEffect(() => {
    let live = true;
    listMedia()
      .then((items) => { if (live) setMedia(items); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Could not load your media."); });
    return () => { live = false; };
  }, []);

  async function upload(files: FileList | File[]) {
    if (!files.length || uploading) return;
    setUploading(true);
    setUploadCount(0);
    setError(null);
    try {
      const images = await prepareImages(files);
      for (let start = 0; start < images.length; start += 3) {
        const batch = images.slice(start, start + 3);
        await Promise.all(batch.map((image) => putImage(image.dataUrl, {
          name: image.name,
          width: image.width,
          height: image.height,
        })));
        setUploadCount(Math.min(start + batch.length, images.length));
      }
      await refresh();
      if (!images.length) setError("Choose PNG, JPEG, GIF, AVIF, or WebP images.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload those images.");
    } finally {
      setUploading(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
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
    <div className="dashboard media-page">
      <header className="dashboard-bar">
        <div><strong>Media</strong><span>Reusable carousel backgrounds</span></div>
        <button className="export-button" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}
          {uploading ? `Uploading ${uploadCount}…` : "Upload images"}
        </button>
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
      </header>

      <section className="dashboard-body media-body">
        <div className="dashboard-heading">
          <div><h1>Media library</h1><p>Upload once, then reuse images across any carousel.</p></div>
          <p>{media === null ? "Loading…" : `${media.length} image${media.length === 1 ? "" : "s"}`}</p>
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
          <span><strong>Drop images here</strong><small>They are resized for carousel backgrounds and stored in your library.</small></span>
          <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>Choose files</button>
        </div>

        {media !== null && media.length === 0 && !error && (
          <div className="empty-state media-empty">
            <h2>Build your background library</h2>
            <p>Upload office shots, portraits, textures, and any other images you use often.</p>
            <button className="export-button" type="button" onClick={() => inputRef.current?.click()}><Upload size={15} /> Upload images</button>
          </div>
        )}

        <ul className="media-grid">
          {(media ?? []).map((asset) => (
            <li className="media-card" key={asset.key}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(asset.key)} alt={asset.name} loading="lazy" />
              <div className="media-card-meta">
                <span><strong>{asset.name}</strong><small>{imageDetails(asset)}</small></span>
                {confirmKey === asset.key ? (
                  <span className="media-confirm">
                    <button type="button" className="danger-action" onClick={() => { void remove(asset); }} disabled={busyKey === asset.key}>
                      {busyKey === asset.key ? <LoaderCircle className="spin" size={13} /> : null} Delete
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
      </section>
    </div>
  );
}
