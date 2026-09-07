import { useEffect, useRef, useState } from "react";
import { type VideoBackground as Clip, videoUrl } from "./video-formats";

export default function VideoBackground({ clip, playing }: { clip: Clip; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const seek = () => { video.currentTime = clip.start; };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    return () => video.removeEventListener("loadedmetadata", seek);
  }, [clip.start]);
  useEffect(() => {
    if (playing) void ref.current?.play().catch(() => undefined);
    else ref.current?.pause();
  }, [playing]);

  return <>
    <video ref={ref} className="slide-image" src={videoUrl(clip.key)} poster={videoUrl(clip.key, "/poster")} muted playsInline preload="metadata" aria-hidden="true"
      onError={() => setFailed(true)}
      onTimeUpdate={(event) => { const video = event.currentTarget; if (video.currentTime >= clip.start + clip.duration || video.currentTime < clip.start - 0.1) video.currentTime = clip.start; }}
      onEnded={(event) => { event.currentTarget.currentTime = clip.start; if (playing) void event.currentTarget.play().catch(() => undefined); }} />
    {failed && <p className="video-preview-error" role="status">Video unavailable. Choose the background again.</p>}
  </>;
}
