"use client";

import { Check, Images, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
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
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listMedia()
      .then((items) => { if (live) setMedia(items); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Could not load your media."); });
    return () => { live = false; };
  }, []);

  async function choose(asset: MediaAsset) {
    setChoosing(asset.key);
    setError(null);
    try {
      await onChoose(asset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not use that image.");
      setChoosing(null);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="composer-dialog media-picker" role="dialog" aria-modal="true" aria-labelledby="media-picker-title">
        <div className="dialog-header">
          <div><span className="dialog-icon"><Images size={17} /></span><div><h2 id="media-picker-title">Choose from media</h2><p>Reuse an image from your library on this slide.</p></div></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(asset.key)} alt="" loading="lazy" />
                <span>{asset.name}</span>
                {choosing === asset.key && <i><LoaderCircle className="spin" size={15} /></i>}
                {choosing !== null && choosing !== asset.key ? null : choosing === null ? <i className="picker-check"><Check size={14} /></i> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="dialog-footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}
