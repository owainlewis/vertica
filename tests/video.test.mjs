import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApi } from "../server/api.ts";
import { LocalBucket } from "../server/bucket.ts";
import { mediaKeysIn } from "../server/store.ts";
import { parseCarouselConfig } from "../app/carousel.ts";
import { boundVideoBackground, MAX_VIDEO_BYTES, parseVideoBackground, VIDEO_CHUNK_BYTES } from "../app/video-formats.ts";

const KEY = "vid:1234567890abcdef1234567890abcdef";
const clip = { key: KEY, start: 1, duration: 1 };
const json = (path, body, method = "POST") => new Request(`http://localhost${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-v", "error", "-nostdin", "-y", ...args], { timeout: 30_000 });
const inspect = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
let encoderAvailable = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); } catch { encoderAvailable = false; }

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vertica-video-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bucket = new LocalBucket(join(directory, "bucket"));
  return { directory, bucket, app: createApi({ bucket, ...options }) };
}

async function upload(app, bytes, name = "Clip.mp4") {
  const init = await app.request(json("/video-uploads", { name, size: bytes.length }));
  assert.equal(init.status, 201);
  const { id, chunkBytes } = await init.json();
  for (let offset = 0, part = 0; offset < bytes.length; offset += chunkBytes, part++) {
    const response = await app.request(`/video-uploads/${id}/${part}`, { method: "PUT", body: bytes.subarray(offset, offset + chunkBytes) });
    assert.equal(response.status, 200);
  }
  const response = await app.request(`/video-uploads/${id}/complete`, { method: "POST" });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.video;
}

test("video configuration round-trips and joins the deck's protected media references", () => {
  const config = parseCarouselConfig(JSON.stringify({ slides: [{ title: "Moving", video: clip }] }));
  assert.deepEqual(config.slides[0].video, clip);
  assert.deepEqual(parseCarouselConfig(JSON.stringify(config)).slides[0].video, clip);
  assert.deepEqual(mediaKeysIn(JSON.stringify(config)), [KEY]);
  for (const invalid of [{ ...clip, key: "https://example.com/movie.mp4" }, { ...clip, start: -1 }, { ...clip, start: Infinity }, { ...clip, duration: 0 }, { ...clip, duration: 31 }]) {
    assert.throws(() => parseVideoBackground(invalid));
  }
  assert.throws(() => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Both", background: "img:1234567890abcdef1234567890abcdef", video: clip }] })), /either a photo or a video/);
});

test("video routes require the same session as the rest of the app", async (t) => {
  const { app } = await fixture(t, { secret: "test-secret" });
  for (const request of [json("/video-uploads", { size: 1 }), json("/video-exports", {}), new Request(`http://localhost/videos/${KEY}`)]) {
    assert.equal((await app.request(request)).status, 401);
  }
});

test("clips fit the actual source duration, including older saved intervals", () => {
  assert.deepEqual(boundVideoBackground({ key: KEY, start: 9, duration: 5 }, 10), { key: KEY, start: 5, duration: 5, sourceDuration: 10 });
  assert.deepEqual(boundVideoBackground({ key: KEY, start: 0, duration: 10 }, 2), { key: KEY, start: 0, duration: 2, sourceDuration: 2 });
  const valid = { ...clip, sourceDuration: 10 };
  assert.deepEqual(parseVideoBackground(valid), valid);
  assert.throws(() => parseVideoBackground({ ...valid, start: 9, duration: 5 }), /fit within the source/);
  for (const sourceDuration of [0, Infinity, "10"]) assert.throws(() => parseVideoBackground({ ...clip, sourceDuration }));
});

test("upload bounds, incomplete chunks, expiry, and cleanup are enforced", async (t) => {
  const { app, bucket } = await fixture(t);
  for (const size of [0, -1, MAX_VIDEO_BYTES + 1, 1.5, "100"]) assert.equal((await app.request(json("/video-uploads", { size }))).status, 400);
  const { id } = await (await app.request(json("/video-uploads", { size: 3 }))).json();
  assert.equal((await app.request(`/video-uploads/${id}/1`, { method: "PUT", body: "abc" })).status, 400);
  assert.equal((await app.request(`/video-uploads/${id}/0`, { method: "PUT", body: "ab" })).status, 400);
  assert.equal((await app.request(`/video-uploads/${id}/0`, { method: "PUT", body: "abc" })).status, 200);
  assert.equal((await app.request(`/video-uploads/${id}`, { method: "DELETE" })).status, 200);
  assert.equal((await bucket.list("video-uploads/")).length, 0);
  await bucket.put("video-uploads/expired/part-0", Buffer.from("old"), { contentType: "application/octet-stream", custom: { expires: "1" } });
  await app.request(json("/video-uploads", { size: 1 }));
  assert.equal(await bucket.head("video-uploads/expired/part-0"), null);
  assert.equal((await app.request(`/videos/${KEY}`)).status, 404);
  assert.equal((await app.request(json("/video-exports", { video: clip, overlay: "bad" }))).status, 404);
});

test("real upload, trim, overlay, MP4 encoding, still frame, ranges, and persistence", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  const { app, bucket, directory } = await fixture(t);
  const source = join(directory, "source.mp4");
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=360x640:r=30:d=3,drawbox=color=blue:t=fill:enable='gte(t,1)'", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", "3", source);
  // Legal trailing padding forces the actual multi-request upload path.
  const bytes = Buffer.alloc(VIDEO_CHUNK_BYTES + 1024);
  (await readFile(source)).copy(bytes);
  const video = await upload(app, bytes);
  assert.equal(video.width, 1080);
  assert.equal(video.height, 1920);
  assert.equal((await bucket.list("video-uploads/")).length, 0);
  assert.deepEqual((await (await app.request("/videos")).json()).videos, [video]);
  assert.equal((await app.request(`/videos/${video.key}/poster`)).headers.get("content-type"), "image/jpeg");
  const stored = await app.request(`/videos/${video.key}`);
  const allBytes = Buffer.from(await stored.arrayBuffer());
  const playback = join(directory, "playback.mp4");
  await writeFile(playback, allBytes);
  assert.deepEqual(inspect(playback).streams.map((stream) => stream.codec_type), ["video"], "background audio is removed");
  const range = await app.request(`/videos/${video.key}`, { headers: { range: "bytes=0-15" } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), allBytes.subarray(0, 16));
  const suffix = await app.request(`/videos/${video.key}`, { headers: { range: "bytes=-10" } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), allBytes.subarray(-10));
  assert.equal((await app.request(`/videos/${video.key}`, { headers: { range: "bytes=999999999-" } })).status, 416);

  const overlay = join(directory, "overlay.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=black@0:s=1080x1350,format=rgba,drawbox=x=100:y=100:w=100:h=100:color=lime:t=fill:replace=1", "-frames:v", "1", overlay);
  const input = { video: { key: video.key, start: 1, duration: 1 }, overlay: `data:image/png;base64,${(await readFile(overlay)).toString("base64")}` };
  const rendered = await app.request(json("/video-exports", input));
  assert.equal(rendered.status, 200);
  assert.equal(rendered.headers.get("content-type"), "video/mp4");
  const output = join(directory, "slide.mp4");
  await writeFile(output, Buffer.from(await rendered.arrayBuffer()));
  const metadata = inspect(output);
  assert.equal(metadata.streams[0].codec_name, "h264");
  assert.equal(metadata.streams[0].width, 1080);
  assert.equal(metadata.streams[0].height, 1350);
  assert.equal(metadata.streams[0].pix_fmt, "yuv420p");
  assert.equal(metadata.streams[0].r_frame_rate, "30/1");
  assert.ok(Math.abs(Number(metadata.format.duration) - 1) < 0.05);
  const pixels = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 8 * 1024 * 1024 });
  const pixel = (x, y) => [...pixels.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)];
  const green = pixel(150, 150);
  const blue = pixel(800, 800);
  assert.ok(green[1] > 220 && green[0] < 30 && green[2] < 30, `overlay is burned in: ${green}`);
  assert.ok(blue[2] > 220 && blue[0] < 30 && blue[1] < 30, `trim selects blue footage and alpha keeps background visible: ${blue}`);
  const frame = await app.request(`/videos/${video.key}/frame?start=1`);
  const still = join(directory, "frame.jpg");
  await writeFile(still, Buffer.from(await frame.arrayBuffer()));
  const stillPixel = execFileSync("ffmpeg", ["-v", "error", "-i", still, "-vf", "scale=1:1", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
  assert.ok(stillPixel[2] > 220 && stillPixel[0] < 30, "static exports use the trimmed first frame");
  assert.equal((await app.request(json("/video-exports", { ...input, overlay: "data:image/png;base64,AAAA" }))).status, 400);
  assert.equal((await app.request(json("/video-exports", { ...input, video: { ...input.video, start: 2.5 } }))).status, 400);
  const config = JSON.stringify({ slides: [{ title: "Moving", video: input.video }] });
  const { carousel } = await (await app.request(json("/carousels", { config }))).json();
  assert.deepEqual(JSON.parse((await (await app.request(`/carousels/${carousel.id}`)).json()).carousel.config).slides[0].video, input.video);
  assert.equal((await app.request(`/videos/${video.key}`, { method: "DELETE" })).status, 409);
});

test("normalization preserves non-square pixels' display aspect ratio", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  const { app, directory } = await fixture(t);
  const source = join(directory, "anamorphic.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=720x576:d=1:r=30,setsar=64/45", "-c:v", "libx264", source);
  const video = await upload(app, await readFile(source));
  assert.ok(Math.abs(video.width / video.height - 16 / 9) < 0.01, `expected 16:9, got ${video.width} × ${video.height}`);
});
