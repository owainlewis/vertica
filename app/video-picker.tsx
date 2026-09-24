import { Film, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Dialog from "./dialog";
import { uploadVideo, videoRequest } from "./video-client";
import { type VideoAsset, videoUrl } from "./video-formats";

export default function VideoPicker({ onChoose, onClose }: { onChoose: (video: VideoAsset) => void; onClose: () => void }) {
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const request = new AbortController();
    void videoRequest("/videos", { signal: request.signal }).then((response) => response.json())
      .then((body) => { if (live.current) setVideos(body.videos); })
      .catch((cause) => { if (live.current && !request.signal.aborted) setError(cause.message); })
      .finally(() => { if (live.current) setLoading(false); });
    return () => { live.current = false; request.abort(); controller.current?.abort(); };
  }, []);

  function choose(video: VideoAsset) { onChoose(video); onClose(); }
  async function upload(file: File) {
    const request = new AbortController();
    controller.current = request;
    setProgress("Uploading…");
    setError("");
    try {
      const video = await uploadVideo(file, (message) => { if (live.current) setProgress(message); }, request.signal);
      if (live.current) choose(video);
    } catch (cause) {
      if (live.current && !request.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not upload the video.");
    } finally {
      if (live.current) { setProgress(""); if (input.current) input.current.value = ""; }
    }
  }

  return <Dialog labelId="video-picker-title" onDismiss={onClose}>
    <section className="composer-dialog media-picker">
      <div className="dialog-header"><div><span className="dialog-icon"><Film size={17} /></span><h2 id="video-picker-title">Choose a video</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      <div className="picker-upload">
        <input ref={input} type="file" aria-label="Video file" hidden accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        <button className="secondary-button" type="button" disabled={Boolean(progress)} aria-busy={Boolean(progress)} onClick={() => input.current?.click()}>
          {progress ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} Upload video
        </button>
        <p className="field-hint">MP4 or MOV · Up to 512 MB and 2 minutes. Backgrounds are silent.</p>
        {progress && <p role="status">{progress}</p>}
      </div>
      <div className="media-picker-body">
        {error && <p className="dashboard-error" role="alert">{error}</p>}
        {loading && <p role="status">Loading videos…</p>}
        {!loading && !videos.length && !error && <div className="picker-empty"><Film size={24} /><strong>No videos yet</strong><span>Upload a clip to place behind your text.</span></div>}
        <div className="media-picker-grid">{videos.map((video) => <button type="button" key={video.key} disabled={Boolean(progress)} onClick={() => choose(video)} aria-label={`Use ${video.name}`}>
          <img src={videoUrl(video.key, "/poster")} alt="" loading="lazy" /><span>{video.name} · {Math.floor(video.duration)}s</span>
        </button>)}</div>
      </div>
      <div className="dialog-footer"><button className="secondary-button" type="button" onClick={onClose}>{progress ? "Cancel upload" : "Cancel"}</button></div>
    </section>
  </Dialog>;
}
