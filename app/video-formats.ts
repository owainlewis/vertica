/** Video backgrounds are silent clips; the source stays outside the carousel JSON. */
export type VideoBackground = { key: string; start: number; duration: number; sourceDuration?: number; framing?: "fill" | "horizontal"; zoom?: number };
export type VideoAsset = { key: string; name: string; duration: number; width: number; height: number };

export const HORIZONTAL_VIDEO_FRAME = { x: 0, y: 540, width: 1080, height: 608, canvasWidth: 1080, canvasHeight: 1350 } as const;

export const VIDEO_KEY_PREFIX = "vid:";
export const VIDEO_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 120;
export const MAX_CLIP_SECONDS = 30;

export function isVideoKey(value: unknown): value is string {
  return typeof value === "string" && /^vid:[a-f0-9]{32}$/.test(value);
}

export function parseVideoBackground(value: unknown): VideoBackground {
  if (!value || typeof value !== "object") throw new Error("Choose an uploaded video background.");
  const video = value as Record<string, unknown>;
  if (!isVideoKey(video.key)) throw new Error("Choose an uploaded video background.");
  if (typeof video.start !== "number" || !Number.isFinite(video.start) || video.start < 0 || video.start >= MAX_VIDEO_SECONDS) {
    throw new Error("The video start must be between 0 and 120 seconds.");
  }
  if (typeof video.duration !== "number" || !Number.isFinite(video.duration) || video.duration < 1 || video.duration > MAX_CLIP_SECONDS) {
    throw new Error("Choose a video duration between 1 and 30 seconds.");
  }
  const sourceDuration = video.sourceDuration;
  if (sourceDuration !== undefined) {
    if (typeof sourceDuration !== "number" || !Number.isFinite(sourceDuration) || sourceDuration < 1 || sourceDuration > MAX_VIDEO_SECONDS) {
      throw new Error("The source video must be between 1 and 120 seconds.");
    }
    if (video.start + video.duration > sourceDuration + 0.000001) throw new Error("The clip must fit within the source video.");
  }
  if (video.framing !== undefined && video.framing !== "fill" && video.framing !== "horizontal") throw new Error("Choose fill or horizontal video framing.");
  if (video.zoom !== undefined && (typeof video.zoom !== "number" || !Number.isFinite(video.zoom) || video.zoom < 1 || video.zoom > 1.3)) throw new Error("Video zoom must be between 1 and 1.3.");
  return { ...(video.framing !== undefined ? { framing: video.framing } : {}), ...(video.zoom !== undefined ? { zoom: video.zoom as number } : {}), key: video.key, start: video.start, duration: video.duration, ...(sourceDuration !== undefined ? { sourceDuration: sourceDuration as number } : {}) };
}

/** Also upgrades older decks once the browser has read the source metadata. */
export function boundVideoBackground(clip: VideoBackground, sourceDuration: number): VideoBackground {
  const duration = Math.max(1, Math.min(clip.duration, MAX_CLIP_SECONDS, sourceDuration));
  return { ...clip, sourceDuration, duration, start: Math.max(0, Math.min(clip.start, sourceDuration - duration)) };
}

/** The API route for a video, relative to `/api`. */
export function videoPath(key: string, part = "") {
  return `/videos/${encodeURIComponent(key)}${part}`;
}

/** The same route as a URL the browser can load directly. */
export function videoUrl(key: string, part = "") {
  return `/api${videoPath(key, part)}`;
}
