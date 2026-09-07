/** Video backgrounds are silent clips; the source stays outside the carousel JSON. */
export type VideoBackground = { key: string; start: number; duration: number };
export type VideoAsset = { key: string; name: string; duration: number; width: number; height: number };

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
  return { key: video.key, start: video.start, duration: video.duration };
}

export function videoUrl(key: string, part = "") {
  return `/api/videos/${encodeURIComponent(key)}${part}`;
}
