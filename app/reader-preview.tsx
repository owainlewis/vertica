import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CarouselConfig } from "./carousel";
import Dialog from "./dialog";
import { Slide } from "./slide";

export default function ReaderPreview({ config, initialIndex, onClose }: {
  config: CarouselConfig;
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [profile, setProfile] = useState(false);
  const move = (direction: number) => setIndex((current) => Math.max(0, Math.min(config.slides.length - 1, current + direction)));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      setIndex((current) => Math.max(0, Math.min(config.slides.length - 1, current + direction)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [config.slides.length]);

  return <Dialog labelId="reader-title" onDismiss={onClose}>
    <section className="reader-dialog">
      <div className="dialog-header"><h2 id="reader-title">Reader preview</h2><button type="button" onClick={onClose} aria-label="Close preview"><X size={18} /></button></div>
      <div className="reader-modes segmented" role="group" aria-label="Preview format">
        <button type="button" aria-pressed={!profile} className={!profile ? "active" : ""} onClick={() => setProfile(false)}>Full slide · 4:5</button>
        <button type="button" aria-pressed={profile} className={profile ? "active" : ""} onClick={() => setProfile(true)}>Profile crop · 3:4</button>
      </div>
      <div className="reader-body">
        <div className={`reader-frame ${profile ? "profile" : ""}`}>
          <Slide slide={config.slides[index]} config={config} index={index} />
        </div>
      </div>
      <div className="reader-controls">
        <button type="button" className="secondary-button icon-button" aria-label="Previous slide" disabled={index === 0} onClick={() => move(-1)}><ArrowLeft size={18} /></button>
        <span role="status" aria-live="polite">{index + 1} of {config.slides.length}</span>
        <button type="button" className="secondary-button icon-button" aria-label="Next slide" disabled={index === config.slides.length - 1} onClick={() => move(1)}><ArrowRight size={18} /></button>
      </div>
    </section>
  </Dialog>;
}
