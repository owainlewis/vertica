import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import type { Bucket, ObjectMeta } from "./bucket.ts";
import { PreconditionError } from "./bucket.ts";
import { mediaInUse } from "./store.ts";
import { isVideoKey, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, parseVideoBackground, VIDEO_CHUNK_BYTES, type VideoAsset } from "../app/video-formats.ts";

const run = promisify(execFile);
const UPLOAD_TTL = 60 * 60 * 1000;
const MAX_OVERLAY_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 96 * 1024 * 1024;

class VideoError extends Error {
  readonly status: 400 | 404 | 409 | 413 | 416 | 503;
  constructor(message: string, status: VideoError["status"] = 400) { super(message); this.status = status; }
}

async function command(program: "ffmpeg" | "ffprobe", args: string[]) {
  try {
    return await run(program, args, { timeout: 180_000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VideoError("Video processing needs FFmpeg and ffprobe installed on the server.", 503);
    }
    console.error(`${program} failed`, (error as Error).message.slice(-1000));
    throw new VideoError("Could not process this video. Try a shorter MP4 or MOV clip.");
  }
}

async function probe(path: string) {
  const { stdout } = await command("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", "mov", "-show_entries", "format=duration:stream=codec_type,codec_name,profile,level,pix_fmt,width,height,avg_frame_rate,r_frame_rate,field_order,sample_aspect_ratio:stream_side_data=rotation", "-of", "json", path]);
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type: string; codec_name?: string; profile?: string; level?: number; pix_fmt?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; field_order?: string; sample_aspect_ratio?: string; side_data_list?: Array<{ rotation?: number }> }> };
  const stream = info.streams?.find((item) => item.codec_type === "video");
  const duration = Number(info.format?.duration);
  const width = stream?.width ?? 0;
  const height = stream?.height ?? 0;
  if (!Number.isFinite(duration) || duration < 1 || duration > MAX_VIDEO_SECONDS || width < 2 || height < 2 || width > 4096 || height > 4096) {
    throw new VideoError("Choose a video from 1 to 120 seconds, up to 4096 pixels on either side.");
  }
  const frameRate = (value?: string) => { const [numerator, denominator] = (value ?? "0/0").split("/").map(Number); return numerator / denominator; };
  const averageRate = frameRate(stream?.avg_frame_rate);
  const nominalRate = frameRate(stream?.r_frame_rate);
  const canCopy = stream?.codec_name === "h264" && stream.pix_fmt === "yuv420p"
    && ["Constrained Baseline", "Baseline", "Main", "High"].includes(stream.profile ?? "")
    && (stream.level ?? 0) > 0 && stream.level! <= 51
    && width <= 3840 && height <= 3840 && width * height <= 3840 * 2160
    && averageRate > 0 && averageRate <= 60 && nominalRate > 0 && nominalRate <= 60
    && (!stream.field_order || stream.field_order === "progressive" || stream.field_order === "unknown")
    && (!stream.sample_aspect_ratio || stream.sample_aspect_ratio === "1:1")
    && !stream.side_data_list?.some((side) => side.rotation);
  return { duration, width, height, canCopy };
}

async function temporary<T>(work: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), "vertica-video-"));
  try { return await work(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new VideoError("That upload is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new VideoError("The upload is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new VideoError("That upload is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

async function jsonBody(request: Request, limit = 4096): Promise<Record<string, unknown>> {
  const bytes = await boundedBody(request, limit);
  try {
    const body: unknown = JSON.parse(bytes.toString());
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new VideoError("The request must be a JSON object."); }
}

function videoPath(key: string) {
  if (!isVideoKey(key)) throw new VideoError("That video key is invalid.");
  return `videos/${key.slice(4)}`;
}

function assetOf(key: string, meta: ObjectMeta): VideoAsset {
  return { key, name: meta.custom.name ?? "Untitled video", duration: Number(meta.custom.duration), width: Number(meta.custom.width), height: Number(meta.custom.height) };
}

type Upload = { name: string; size: number; expires: number };
function uploadPath(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new VideoError("That upload is invalid.");
  return `video-uploads/${id}/`;
}

export function videoRoutes(bucket: Bucket) {
  const api = new Hono();
  // One encoder per instance bounds CPU and memory. A busy response is retryable.
  let processing = false;
  async function job<T>(work: () => Promise<T>) {
    if (processing) throw new VideoError("Another video is processing. Try again shortly.", 503);
    processing = true;
    try { return await work(); } finally { processing = false; }
  }

  async function uploadInfo(id: string) {
    const object = await bucket.get(`${uploadPath(id)}manifest`);
    if (!object) throw new VideoError("This upload has expired. Choose the video again.", 404);
    const upload = JSON.parse(new TextDecoder().decode(object.bytes)) as Upload;
    if (upload.expires < Date.now()) throw new VideoError("This upload has expired. Choose the video again.", 404);
    return upload;
  }

  async function clearUpload(id: string) {
    for (const { key } of await bucket.list(uploadPath(id))) await bucket.delete(key);
  }

  async function exportSource(key: string) {
    const path = videoPath(key);
    const meta = await bucket.head(`${path}.mp4`);
    if (!meta) throw new VideoError("That video is gone. Choose another background.", 404);
    // Older uploads only have their playback copy. A missing new original is an
    // error, so a broken upload cannot silently downgrade the export's quality.
    const object = await bucket.get(`${path}.${meta.custom.original === "1" ? "original" : "mp4"}`);
    if (!object) throw new VideoError("The source video is missing. Upload it again.", 404);
    return { bytes: object.bytes, meta };
  }

  api.post("/video-uploads", async (c) => {
    const input = await jsonBody(c.req.raw);
    if (!Number.isInteger(input.size) || (input.size as number) < 1 || (input.size as number) > MAX_VIDEO_BYTES) {
      throw new VideoError("Choose an MP4 or MOV under 512 MB.");
    }
    // Abandoned chunks expire even when the browser never gets to send Cancel.
    for (const { key, meta } of await bucket.list("video-uploads/")) {
      if (Number(meta.custom.expires) < Date.now()) await bucket.delete(key);
    }
    const id = randomUUID();
    const expires = Date.now() + UPLOAD_TTL;
    const upload: Upload = { name: typeof input.name === "string" ? input.name.trim().slice(0, 180) || "Untitled video" : "Untitled video", size: input.size as number, expires };
    await bucket.put(`${uploadPath(id)}manifest`, Buffer.from(JSON.stringify(upload)), { contentType: "application/json", custom: { expires: String(expires) } });
    return c.json({ id, chunkBytes: VIDEO_CHUNK_BYTES }, 201);
  });

  api.put("/video-uploads/:id/:part", async (c) => {
    const id = c.req.param("id");
    const upload = await uploadInfo(id);
    const part = Number(c.req.param("part"));
    const count = Math.ceil(upload.size / VIDEO_CHUNK_BYTES);
    if (!Number.isInteger(part) || part < 0 || part >= count) throw new VideoError("That upload chunk is invalid.");
    const bytes = await boundedBody(c.req.raw, VIDEO_CHUNK_BYTES);
    if (bytes.byteLength !== Math.min(VIDEO_CHUNK_BYTES, upload.size - part * VIDEO_CHUNK_BYTES)) throw new VideoError("That upload chunk is incomplete. Choose the video again.");
    await bucket.put(`${uploadPath(id)}part-${part}`, bytes, { contentType: "application/octet-stream", custom: { expires: String(upload.expires) } });
    return c.json({ ok: true });
  });

  api.delete("/video-uploads/:id", async (c) => {
    const id = c.req.param("id");
    if (await bucket.head(`${uploadPath(id)}lock`)) throw new VideoError("This video is still processing.", 409);
    await clearUpload(id);
    return c.json({ ok: true });
  });

  api.post("/video-uploads/:id/complete", async (c) => job(async () => {
    const id = c.req.param("id");
    const upload = await uploadInfo(id);
    try {
      await bucket.put(`${uploadPath(id)}lock`, new Uint8Array(), { contentType: "text/plain", ifGeneration: 0, custom: { expires: String(upload.expires) } });
    } catch (error) {
      if (error instanceof PreconditionError) throw new VideoError("This video is already processing.", 409);
      throw error;
    }
    try {
      const asset = await temporary(async (dir) => {
        const source = join(dir, "source.mov");
        const output = join(dir, "video.mp4");
        const poster = join(dir, "poster.jpg");
        for (let part = 0; part < Math.ceil(upload.size / VIDEO_CHUNK_BYTES); part++) {
          const chunk = await bucket.get(`${uploadPath(id)}part-${part}`);
          if (!chunk || chunk.bytes.byteLength !== Math.min(VIDEO_CHUNK_BYTES, upload.size - part * VIDEO_CHUNK_BYTES)) throw new VideoError("The video upload is incomplete. Choose it again.");
          await appendFile(source, chunk.bytes);
        }
        const sourceInfo = await probe(source);
        const input = ["-v", "error", "-nostdin", "-y", "-threads", "2", "-protocol_whitelist", "file,pipe", "-f", "mov", "-i", source, "-map", "0:v:0", "-an"];
        // Stream copy repackages compatible clips without changing their pixels,
        // resolution or frame rate. Only incompatible/large previews need encoding.
        if (sourceInfo.canCopy) await command("ffmpeg", [...input, "-c:v", "copy", "-movflags", "+faststart", output]);
        if (!sourceInfo.canCopy || (await stat(output)).size > MAX_OUTPUT_BYTES) {
          await command("ffmpeg", [...input,
            "-vf", "scale=w='max(2,round(min(1080,1920*dar)/2)*2)':h='max(2,round(min(1920,1080/dar)/2)*2)',setsar=1,fps='min(source_fps,30)'", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output]);
        }
        if ((await stat(output)).size > MAX_OUTPUT_BYTES) throw new VideoError("The processed video is too large. Try a shorter clip.");
        const { duration, width, height } = await probe(output);
        // Each attempt owns its objects. Rollback must never remove a successful
        // concurrent upload, even when its original bytes happen to be identical.
        const key = `vid:${randomUUID().replaceAll("-", "")}`;
        await command("ffmpeg", ["-v", "error", "-nostdin", "-y", "-threads", "2", "-i", output, "-frames:v", "1", "-vf", "scale=540:-2", poster]);
        const path = videoPath(key);
        try {
          await bucket.put(`${path}.original`, await readFile(source), { contentType: "application/octet-stream" });
          await bucket.put(`${path}.jpg`, await readFile(poster), { contentType: "image/jpeg" });
          await bucket.put(`${path}.mp4`, await readFile(output), { contentType: "video/mp4", custom: { name: upload.name, duration: String(duration), width: String(width), height: String(height), original: "1" } });
        } catch (error) {
          await Promise.allSettled(["original", "jpg", "mp4"].map((extension) => bucket.delete(`${path}.${extension}`)));
          throw error;
        }
        return { key, name: upload.name, duration, width, height };
      });
      return c.json({ video: asset }, 201);
    } finally { await clearUpload(id); }
  }));

  api.get("/videos", async (c) => {
    const objects = await bucket.list("videos/");
    const removed = new Set(objects.filter(({ key }) => key.endsWith(".removed")).map(({ key }) => key.slice(0, -8)));
    return c.json({ videos: objects.filter(({ key }) => key.endsWith(".mp4") && !removed.has(key.slice(0, -4)))
      .sort((a, b) => b.meta.updated.localeCompare(a.meta.updated)).map(({ key, meta }) => assetOf(`vid:${key.slice(7, -4)}`, meta)) });
  });

  api.get("/videos/:key/poster", async (c) => {
    const object = await bucket.get(`${videoPath(c.req.param("key"))}.jpg`);
    if (!object) throw new VideoError("That video is gone. Choose another background.", 404);
    return new Response(object.bytes as BodyInit, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
  });

  api.get("/videos/:key", async (c) => {
    const object = await bucket.get(`${videoPath(c.req.param("key"))}.mp4`);
    if (!object) throw new VideoError("That video is gone. Choose another background.", 404);
    const size = object.bytes.byteLength;
    const headers = { "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "private, max-age=31536000, immutable" };
    const range = c.req.header("range");
    if (!range) return new Response(object.bytes as BodyInit, { headers: { ...headers, "content-length": String(size) } });
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
    const end = match?.[1] && match?.[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start >= size || end < start) {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    }
    return new Response(object.bytes.slice(start, end + 1) as BodyInit, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  });

  api.delete("/videos/:key", async (c) => {
    const key = c.req.param("key");
    const path = videoPath(key);
    if (await mediaInUse(bucket, key)) throw new VideoError("This video is used by a carousel. Remove it from the slides first.", 409);
    if (!(await bucket.head(`${path}.mp4`))) throw new VideoError("That video is gone.", 404);
    // Retain every rendition: a different server can save a reference after the check.
    await bucket.put(`${path}.removed`, new Uint8Array(), { contentType: "application/octet-stream" });
    return c.json({ ok: true });
  });

  api.get("/videos/:key/frame", async (c) => job(() => temporary(async (dir) => {
    const object = await exportSource(c.req.param("key"));
    const start = Number(c.req.query("start") ?? 0);
    if (!Number.isFinite(start) || start < 0 || start >= Number(object.meta.custom.duration)) throw new VideoError("The clip starts outside this video.");
    const source = join(dir, "source.mp4");
    const frame = join(dir, "frame.jpg");
    await writeFile(source, object.bytes);
    await command("ffmpeg", ["-v", "error", "-nostdin", "-y", "-threads", "2", "-protocol_whitelist", "file,pipe", "-f", "mov", "-ss", String(start), "-i", source, "-frames:v", "1", "-vf", "scale=w='max(2,round(ih*dar/2)*2)':h=ih,setsar=1", "-q:v", "2", frame]);
    return new Response(await readFile(frame), { headers: { "content-type": "image/jpeg" } });
  })));

  api.post("/video-exports", async (c) => job(() => temporary(async (dir) => {
    const input = await jsonBody(c.req.raw, MAX_OVERLAY_BYTES * 1.4);
    let clip;
    try { clip = parseVideoBackground(input.video); } catch (error) { throw new VideoError((error as Error).message); }
    const object = await exportSource(clip.key);
    if (clip.start + clip.duration > Number(object.meta.custom.duration) + 0.01) throw new VideoError("The clip ends after the video. Reduce its start or duration.");
    if (typeof input.overlay !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.overlay)) throw new VideoError("The text overlay must be a PNG.");
    const png = Buffer.from(input.overlay.slice("data:image/png;base64,".length), "base64");
    if (png.length > MAX_OVERLAY_BYTES || png.length < 33 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || png.toString("ascii", 12, 16) !== "IHDR" || png.readUInt32BE(16) !== 1080 || png.readUInt32BE(20) !== 1350) {
      throw new VideoError("The text overlay must be a 1080 × 1350 PNG under 8 MB.");
    }
    const source = join(dir, "source.mp4");
    const overlay = join(dir, "overlay.png");
    const output = join(dir, "slide.mp4");
    await writeFile(source, object.bytes);
    await writeFile(overlay, png);
    await command("ffmpeg", ["-v", "error", "-nostdin", "-y", "-threads", "2", "-protocol_whitelist", "file,pipe", "-f", "mov", "-ss", String(clip.start), "-i", source, "-i", overlay,
      "-filter_complex_threads", "1", "-filter_complex", "[0:v]scale=w='ceil(max(1080,1350*dar)/2)*2':h='ceil(max(1350,1080/dar)/2)*2':flags=lanczos,crop=1080:1350,setsar=1[bg];[bg][1:v]overlay=0:0:format=auto,format=yuv420p,sidedata=mode=delete:type=DISPLAYMATRIX[out]",
      "-map", "[out]", "-an", "-t", String(clip.duration), "-r", "30", "-c:v", "libx264", "-threads", "2", "-preset", "medium", "-crf", "16", "-movflags", "+faststart", output]);
    return new Response(await readFile(output), { headers: { "content-type": "video/mp4", "content-disposition": 'attachment; filename="slide.mp4"', "cache-control": "no-store" } });
  })));

  api.onError((error, c) => {
    if (error instanceof VideoError) return c.json({ error: error.message }, error.status);
    console.error("video request failed", error);
    return c.json({ error: "Video processing failed. Try again." }, 503);
  });
  return api;
}
