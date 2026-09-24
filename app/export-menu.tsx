import { ChevronDown, Download, Film, Images, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

export default function ExportMenu({ busy, video = false, onExport }: {
  busy: boolean;
  video?: boolean;
  onExport: (kind: "pdf" | "zip" | "mp4") => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current) ref.current.open = false;
    };
    const details = ref.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details) {
        event.preventDefault();
        details.open = false;
        details.querySelector("summary")?.focus();
      }
    };
    details?.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", closeOutside);
    return () => { details?.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", closeOutside); };
  }, []);

  function choose(kind: "pdf" | "zip" | "mp4") {
    if (busy) return;
    if (ref.current) {
      ref.current.open = false;
      ref.current.querySelector("summary")?.focus();
    }
    onExport(kind);
  }

  return <details ref={ref} className="export-control"
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
    <summary className="export-button" aria-busy={busy} aria-label={busy ? "Exporting carousel" : "Export"}>
      {busy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
      <span>Export</span><ChevronDown size={14} />
    </summary>
    <div className="export-options" aria-label="Export format">
      <button type="button" disabled={busy || !video} onClick={() => choose("mp4")}><Film size={16} /><span>Video slide<small>{video ? "Selected slide · MP4 · Silent" : "Choose a slide with a video background"}</small></span></button>
      <button type="button" disabled={busy} onClick={() => choose("zip")}><Images size={16} /><span>JPEG images<small>Numbered files in a ZIP · Instagram</small></span></button>
      <button type="button" disabled={busy} onClick={() => choose("pdf")}><Download size={16} /><span>PDF document<small>One slide per page · LinkedIn</small></span></button>
    </div>
  </details>;
}
