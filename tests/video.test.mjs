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

async function upload(app, bytes, name = "Clip.mp4", expectedStatus = 201) {
  const init = await app.request(json("/video-uploads", { name, size: bytes.length }));
  assert.equal(init.status, 201);
  const { id, chunkBytes } = await init.json();
  for (let offset = 0, part = 0; offset < bytes.length; offset += chunkBytes, part++) {
    const response = await app.request(`/video-uploads/${id}/${part}`, { method: "PUT", body: bytes.subarray(offset, offset + chunkBytes) });
    assert.equal(response.status, 200);
  }
  const response = await app.request(`/video-uploads/${id}/complete`, { method: "POST" });
  const body = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(body));
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
  assert.equal(video.width, 360, "compatible previews keep their original resolution");
  assert.equal(video.height, 640);
  assert.deepEqual(Buffer.from((await bucket.get(`videos/${video.key.slice(4)}.original`)).bytes), bytes, "the original is retained byte for byte");
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
  assert.ok(await bucket.head(`videos/${video.key.slice(4)}.original`), "a referenced original cannot be deleted");
  assert.equal((await app.request(`/carousels/${carousel.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await app.request(`/videos/${video.key}`, { method: "DELETE" })).status, 200);
  assert.deepEqual((await (await app.request("/videos")).json()).videos, [], "removal hides the library entry");
  assert.equal((await app.request(`/videos/${video.key}`)).status, 200);
  assert.equal((await app.request(`/videos/${video.key}/poster`)).status, 200);
  assert.ok(await bucket.head(`videos/${video.key.slice(4)}.original`), "the export original survives removal");
});

test("compatible previews preserve every decoded frame and the source frame rate", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  const { app, bucket, directory } = await fixture(t);
  const source = join(directory, "detail.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1280x720:d=1:r=24000/1001", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", source);
  const video = await upload(app, await readFile(source));
  const preview = join(directory, "preview.mp4");
  await writeFile(preview, (await bucket.get(`videos/${video.key.slice(4)}.mp4`)).bytes);
  const frameHash = (file) => ffmpeg("-i", file, "-map", "0:v:0", "-f", "hash", "-hash", "sha256", "pipe:1").toString();
  assert.equal(frameHash(preview), frameHash(source), "stream copy must not change a decoded pixel");
  assert.equal(inspect(preview).streams[0].r_frame_rate, "24000/1001");
  assert.equal(video.width, 1280);
  assert.equal(video.height, 720);
});

test("failed asset writes remove partial files without touching an identical successful upload", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  const { app, bucket, directory } = await fixture(t);
  const source = join(directory, "source.mp4");
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=320x400:d=1:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", source);
  const bytes = await readFile(source);
  const existing = await upload(app, bytes);
  const originalPut = bucket.put.bind(bucket);
  t.mock.method(console, "error", () => {});
  for (const extension of ["original", "jpg", "mp4"]) {
    let failed = false;
    bucket.put = async (key, data, options) => {
      const result = await originalPut(key, data, options);
      // Simulate a failure after the storage write, including an uncertain
      // completion result from the final MP4 write.
      if (!failed && key.startsWith("videos/") && key.endsWith(`.${extension}`)) {
        failed = true;
        throw new Error("Storage write interrupted");
      }
      return result;
    };
    await upload(app, bytes, "Retry.mp4", 503);
    assert.ok(failed);
    const files = await bucket.list("videos/");
    assert.equal(files.length, 3, `no orphan remains after the ${extension} write fails`);
    assert.ok(files.every(({ key }) => key.startsWith(`videos/${existing.key.slice(4)}.`)));
    assert.deepEqual(Buffer.from((await bucket.get(`videos/${existing.key.slice(4)}.original`)).bytes), bytes);
    assert.equal((await bucket.list("video-uploads/")).length, 0);
  }
});

test("cleanup attempts every file and preserves the write error if a deletion also fails", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  const { app, bucket, directory } = await fixture(t);
  const source = join(directory, "source.mp4");
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=320x400:d=1:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", source);
  const originalPut = bucket.put.bind(bucket);
  const originalDelete = bucket.delete.bind(bucket);
  const writeError = new Error("Original write failure");
  const log = t.mock.method(console, "error", () => {});
  const attempted = [];
  bucket.put = async (key, bytes, options) => {
    const result = await originalPut(key, bytes, options);
    if (key.startsWith("videos/") && key.endsWith(".jpg")) throw writeError;
    return result;
  };
  bucket.delete = async (key) => {
    if (key.startsWith("videos/")) attempted.push(key.split(".").at(-1));
    if (key.endsWith(".original")) throw new Error("Cleanup deletion failure");
    return originalDelete(key);
  };
  await upload(app, await readFile(source), "Failure.mp4", 503);
  assert.deepEqual(attempted.sort(), ["jpg", "mp4", "original"]);
  assert.equal(log.mock.calls[0].arguments[1], writeError);
  assert.ok((await bucket.list("videos/")).every(({ key }) => key.endsWith(".original")), "other cleanup deletions finish before the response");
});

test("out-of-range H.264 decoder requirements use a preview capped at 30 fps without raising slower rates", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  for (const scenario of [
    { name: "high level", size: "320x400", rate: "24", expectedRate: "24/1", options: ["-level:v", "6.0"] },
    { name: "high frame rate", size: "320x400", rate: "120", expectedRate: "30/1", options: ["-level:v", "5.1"] },
    { name: "oversized dimensions", size: "4096x2160", rate: "1", expectedRate: "1/1", options: ["-level:v", "5.1"] },
    { name: "unsupported profile", size: "320x400", rate: "30", expectedRate: "30/1", options: ["-crf", "0"] },
  ]) {
    await t.test(scenario.name, async (subtest) => {
      const { app, bucket, directory } = await fixture(subtest);
      const source = join(directory, "source.mp4");
      ffmpeg("-f", "lavfi", "-i", `color=c=red:s=${scenario.size}:d=1:r=${scenario.rate}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", ...scenario.options, source);
      const video = await upload(app, await readFile(source));
      const preview = join(directory, "preview.mp4");
      await writeFile(preview, (await bucket.get(`videos/${video.key.slice(4)}.mp4`)).bytes);
      const stream = inspect(preview).streams[0];
      assert.equal(stream.r_frame_rate, scenario.expectedRate);
      assert.ok(stream.width <= 1080 && stream.height <= 1920);
      assert.ok(stream.level <= 41);
      assert.notEqual(stream.profile, "High 4:4:4 Predictive");
      assert.deepEqual(Buffer.from((await bucket.get(`videos/${video.key.slice(4)}.original`)).bytes), await readFile(source));
    });
  }
});

test("exports read the original even when the preview differs; old uploads still export", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  const { app, bucket, directory } = await fixture(t);
  const source = join(directory, "source.mov");
  // A non-H.264 source exercises the encoded-preview compatibility path.
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=320x400:d=2:r=30", "-c:v", "prores_ks", "-pix_fmt", "yuv422p10le", source);
  const sourceBytes = await readFile(source);
  const video = await upload(app, sourceBytes);
  const path = `videos/${video.key.slice(4)}`;
  assert.deepEqual(Buffer.from((await bucket.get(`${path}.original`)).bytes), sourceBytes);
  const replacement = join(directory, "blue.mp4");
  ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=320x400:d=2:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", replacement);
  const meta = await bucket.head(`${path}.mp4`);
  await bucket.put(`${path}.mp4`, await readFile(replacement), { contentType: "video/mp4", custom: meta.custom });
  const overlay = join(directory, "clear.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=black@0:s=1080x1350,format=rgba", "-frames:v", "1", overlay);
  const input = { video: { key: video.key, start: 0, duration: 1 }, overlay: `data:image/png;base64,${(await readFile(overlay)).toString("base64")}` };
  async function exportedPixel() {
    const response = await app.request(json("/video-exports", input));
    assert.equal(response.status, 200);
    const output = join(directory, "export.mp4");
    await writeFile(output, Buffer.from(await response.arrayBuffer()));
    return ffmpeg("-i", output, "-vf", "scale=1:1", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1");
  }
  const red = await exportedPixel();
  assert.ok(red[0] > 220 && red[2] < 30, `MP4 uses the red original, not the blue preview: ${red}`);
  const frame = await app.request(`/videos/${video.key}/frame`);
  const still = join(directory, "still.jpg");
  await writeFile(still, Buffer.from(await frame.arrayBuffer()));
  const stillPixel = ffmpeg("-i", still, "-vf", "scale=1:1", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1");
  assert.ok(stillPixel[0] > 220 && stillPixel[2] < 30, "PDF/JPEG frames also use the original");
  await bucket.delete(`${path}.original`);
  assert.equal((await app.request(json("/video-exports", input))).status, 404, "a missing original must not silently reduce quality");
  const legacy = { ...meta.custom };
  delete legacy.original;
  await bucket.put(`${path}.mp4`, await readFile(replacement), { contentType: "video/mp4", custom: legacy });
  const blue = await exportedPixel();
  assert.ok(blue[2] > 220 && blue[0] < 30, "older uploads still export from their retained playback copy");
});

test("preview and original-source exports preserve non-square pixels' display aspect ratio", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  const { app, directory } = await fixture(t);
  const source = join(directory, "anamorphic.mp4");
  ffmpeg("-f", "lavfi", "-i", "color=c=black:s=720x576:d=1:r=30,drawbox=x=260:y=188:w=200:h=200:color=white:t=fill,setsar=64/45", "-c:v", "libx264", source);
  const video = await upload(app, await readFile(source));
  assert.ok(Math.abs(video.width / video.height - 16 / 9) < 0.01, `expected 16:9, got ${video.width} × ${video.height}`);
  const overlay = join(directory, "clear.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=black@0:s=1080x1350,format=rgba", "-frames:v", "1", overlay);
  const response = await app.request(json("/video-exports", { video: { key: video.key, start: 0, duration: 1 }, overlay: `data:image/png;base64,${(await readFile(overlay)).toString("base64")}` }));
  assert.equal(response.status, 200);
  const output = join(directory, "export.mp4");
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
  const pixels = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], { maxBuffer: 2 * 1024 * 1024 });
  const horizontal = Array.from({ length: 1080 }, (_, x) => pixels[675 * 1080 + x]).filter((value) => value > 200).length;
  const vertical = Array.from({ length: 1350 }, (_, y) => pixels[y * 1080 + 540]).filter((value) => value > 200).length;
  assert.ok(Math.abs(horizontal / vertical - 64 / 45) < 0.02, `the source's displayed rectangle must not be squashed: ${horizontal} × ${vertical}`);
});

test("rotated originals export upright pixels without rotating the completed slide again", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  const { app, directory } = await fixture(t);
  const landscape = join(directory, "landscape.mp4");
  const source = join(directory, "portrait.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=640x360:d=1:r=30", "-c:v", "libx264", landscape);
  ffmpeg("-display_rotation", "90", "-i", landscape, "-c", "copy", source);
  assert.equal(inspect(source).streams[0].side_data_list[0].rotation, 90, "the fixture must carry a display matrix");
  const video = await upload(app, await readFile(source));
  assert.ok(video.height > video.width, "preview applies source orientation");
  const overlay = join(directory, "clear.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=black@0:s=1080x1350,format=rgba", "-frames:v", "1", overlay);
  const response = await app.request(json("/video-exports", { video: { key: video.key, start: 0, duration: 1 }, overlay: `data:image/png;base64,${(await readFile(overlay)).toString("base64")}` }));
  assert.equal(response.status, 200);
  const output = join(directory, "slide.mp4");
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
  const stream = inspect(output).streams[0];
  assert.ok(!stream.side_data_list?.some((side) => side.rotation), "export must not carry stale rotation metadata");
  const displayed = join(directory, "displayed.png");
  ffmpeg("-i", output, "-frames:v", "1", displayed);
  const decoded = inspect(displayed).streams[0];
  assert.equal(decoded.width, 1080);
  assert.equal(decoded.height, 1350);
});


test("video removal retains every rendition when a deck saves after the reference check", async (t) => {
  const { bucket, app } = await fixture(t);
  const path = `videos/${KEY.slice(4)}`;
  for (const extension of ["mp4", "jpg", "original"]) {
    await bucket.put(`${path}.${extension}`, new Uint8Array([1, 2, 3]), { contentType: extension === "jpg" ? "image/jpeg" : "video/mp4" });
  }
  const list = bucket.list.bind(bucket);
  bucket.list = async (prefix) => {
    const beforeSave = await list(prefix);
    if (prefix === "carousels/") {
      await app.request(json("/carousels", { id: "concurrent", config: JSON.stringify({ slides: [{ title: "Moving", video: clip }] }) }));
    }
    return beforeSave;
  };
  assert.equal((await app.request(`/videos/${KEY}`, { method: "DELETE" })).status, 200);
  assert.deepEqual((await (await app.request("/videos")).json()).videos, []);
  for (const extension of ["mp4", "jpg", "original"]) {
    assert.deepEqual((await bucket.get(`${path}.${extension}`)).bytes, new Uint8Array([1, 2, 3]));
  }
  assert.equal((await app.request(`/videos/${KEY}`)).status, 200);
  assert.equal((await app.request(`/videos/${KEY}/poster`)).status, 200);
  assert.equal((await app.request("/carousels/concurrent")).status, 200);
});


test("horizontal framing and zoom persist and reject unsupported geometry", () => {
  const video = { ...clip, framing: "horizontal", zoom: 1.12 };
  const config = parseCarouselConfig(JSON.stringify({ slides: [{ title: "Landscape", video }] }));
  assert.deepEqual(config.slides[0].video, video);
  assert.deepEqual(boundVideoBackground(video, 10), { ...video, sourceDuration: 10 });
  for (const invalid of [{ ...video, framing: "stretch" }, { ...video, zoom: 0.9 }, { ...video, zoom: 1.31 }, { ...video, zoom: NaN }, { ...video, zoom: "1.1" }]) assert.throws(() => parseVideoBackground(invalid));
});

test("horizontal exports keep black text space, contain footage and crop only when zoomed", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  const { app, directory } = await fixture(t);
  const overlayPath = join(directory, "overlay.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=black@0:s=1080x1350,format=rgba,drawbox=x=100:y=100:w=100:h=100:color=lime:t=fill:replace=1", "-frames:v", "1", overlayPath);
  const overlay = `data:image/png;base64,${(await readFile(overlayPath)).toString("base64")}`;
  for (const [size, zoom, edgeBlue] of [["640x360", 1, true], ["640x360", 1.3, false], ["640x480", 1, false], ["360x640", 1, false]]) {
    const source = join(directory, `source-${size}-${zoom}.mp4`);
    ffmpeg("-f", "lavfi", "-i", `color=c=red:s=${size}:r=30:d=1,drawbox=x=0:y=0:w=50:h=ih:color=blue:t=fill`, "-c:v", "libx264", "-pix_fmt", "yuv420p", source);
    const asset = await upload(app, await readFile(source));
    const response = await app.request(json("/video-exports", { video: { key: asset.key, start: 0, duration: 1, framing: "horizontal", zoom }, overlay }));
    assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
    const output = join(directory, `out-${size}-${zoom}.mp4`);
    await writeFile(output, Buffer.from(await response.arrayBuffer()));
    const pixels = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 8 * 1024 * 1024 });
    const pixel = (x, y) => [...pixels.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)];
    assert.ok(pixel(540, 400).every(v => v < 10), "top text band stays black");
    assert.ok(pixel(540, 1250).every(v => v < 10), "footer stays black");
    assert.ok(pixel(150, 150)[1] > 220, "text overlay remains visible");
    assert.ok(pixel(540, 800)[0] > 220, "footage stays visible in its window");
    if (edgeBlue) assert.ok(pixel(30, 800)[2] > 220, "1x preserves the source edge");
    else if (size === "640x360") assert.ok(pixel(30, 800)[0] > 220, "zoom crops the source edge");
    else assert.ok(pixel(30, 800).every(v => v < 10), "non-wide inputs are contained without stretching");
  }
});
