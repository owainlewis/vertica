import { MAX_VIDEO_BYTES, type VideoAsset, type VideoBackground, videoUrl } from "./video-formats";

export async function videoRequest(path: string, init?: RequestInit) {
  const response = await fetch(`/api${path}`, { ...init, signal: init?.signal ?? AbortSignal.timeout(200_000) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "The video request failed. Try again.");
  }
  return response;
}

export async function uploadVideo(file: File, onProgress: (message: string) => void, signal: AbortSignal): Promise<VideoAsset> {
  if (!/\.(mp4|mov)$/i.test(file.name) || file.size < 1 || file.size > MAX_VIDEO_BYTES) throw new Error("Choose an MP4 or MOV under 512 MB.");
  let id: string | undefined;
  try {
    const session = await (await videoRequest("/video-uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name, size: file.size }), signal })).json();
    id = session.id;
    for (let offset = 0, part = 0; offset < file.size; offset += session.chunkBytes, part++) {
      onProgress(`Uploading… ${Math.round(offset / file.size * 100)}%`);
      await videoRequest(`/video-uploads/${id}/${part}`, { method: "PUT", body: file.slice(offset, offset + session.chunkBytes), signal });
    }
    onProgress("Preparing video…");
    const result = await (await videoRequest(`/video-uploads/${id}/complete`, { method: "POST", signal })).json();
    return result.video;
  } finally {
    if (id) void videoRequest(`/video-uploads/${id}`, { method: "DELETE" }).catch(() => undefined);
  }
}

export async function videoFrame(clip: VideoBackground) {
  const response = await videoRequest(`${videoUrl(clip.key, "/frame").slice(4)}?start=${clip.start}`);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the video frame."));
    reader.readAsDataURL(blob);
  });
}
