import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

register("./component-loader.mjs", import.meta.url);
const { FILM_GRADE, filmGradeCss, filmGradeFfmpeg, filmGradeMatrix } = await import("../app/film-grade.ts");
const { parseCarouselConfig } = await import("../app/carousel.ts");
const { Slide } = await import("../app/slide.tsx");
const { createApi } = await import("../server/api.ts");
const { LocalBucket } = await import("../server/bucket.ts");

const json = (path, body) => new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-v", "error", "-nostdin", "-y", ...args], { timeout: 30_000 });
let encoderAvailable = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { encoderAvailable = false; }

/** The CSS filter's result for one sRGB colour, which Chrome matches exactly. */
function graded([r, g, b]) {
  const contrast = (value) => Math.min(255, Math.max(0, (value - 127.5) * FILM_GRADE.contrast + 127.5));
  const [R, G, B] = [contrast(r), contrast(g), contrast(b)];
  const m = filmGradeMatrix();
  return [m[0] * R + m[1] * G + m[2] * B, m[3] * R + m[4] * G + m[5] * B, m[6] * R + m[7] * G + m[8] * B].map((value) => Math.min(255, value));
}

test("the film grade is one definition: CSS functions in order and the matching ffmpeg chain", () => {
  assert.equal(filmGradeCss(), `contrast(${FILM_GRADE.contrast}) saturate(${FILM_GRADE.saturate}) sepia(${FILM_GRADE.sepia}) brightness(${FILM_GRADE.brightness})`);
  // A neutral grade is the identity, so the matrix maths is the spec's and not an approximation.
  const neutral = filmGradeMatrix({ contrast: 1, saturate: 1, sepia: 0, brightness: 1, grain: 0 });
  [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((value, index) => assert.ok(Math.abs(neutral[index] - value) < 1e-9));
  const chain = filmGradeFfmpeg();
  assert.match(chain, /^format=rgb24,lutrgb=r='clip\(\(val-127\.5\)\*1\.08\+127\.5,0,255\)'/);
  assert.match(chain, /colorchannelmixer=rr=[\d.]+:rg=/);
  assert.match(chain, /noise=alls=7:allf=t\+u$/);
});

test("the grade is a deck setting that survives a JSON round trip; unknown grades are dropped", () => {
  const parse = (grade) => parseCarouselConfig(JSON.stringify({ grade, slides: [{ title: "One" }] })).grade;
  assert.equal(parse("film"), "film");
  assert.equal(parse("sepia"), undefined);
  assert.equal(parse(undefined), undefined);
});

test("only photo and video slides are graded, with a vignette and a still grain texture", () => {
  const render = (slide, grade) => new JSDOM(renderToStaticMarkup(createElement(Slide, {
    slide, config: { version: 1, title: "Deck", author: "A", theme: "cinematic", ...(grade ? { grade } : {}), slides: [slide] }, index: 0,
  }))).window.document;
  const photo = { id: "p", layout: "content", title: "Photo", body: "", background: "data:image/png;base64,iVBORw0KGgo=" };
  const plain = { id: "q", layout: "content", title: "Plain", body: "" };
  const doc = render(photo, "film");
  assert.ok(doc.querySelector("article").classList.contains("grade-film"));
  assert.ok(doc.querySelector(".slide-vignette") && doc.querySelector(".slide-grain"));
  assert.match(doc.querySelector("article").getAttribute("style"), /--film-grade:contrast\(1\.08\)/);
  for (const document of [render(plain, "film"), render(photo, undefined)]) {
    assert.ok(!document.querySelector("article").classList.contains("grade-film"));
    assert.equal(document.querySelector(".slide-grain"), null);
  }
});

test("a graded MP4 export matches the preview's colour and an ungraded one is untouched", { skip: !encoderAvailable && "Install FFmpeg for video integration checks" }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "vertica-grade-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = createApi({ bucket: new LocalBucket(join(directory, "bucket")) });
  const colour = [200, 120, 60];
  const source = join(directory, "source.mp4");
  ffmpeg("-f", "lavfi", "-i", "color=c=0xc8783c:s=320x400:r=30:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", source);
  const bytes = await readFile(source);
  const init = await (await app.request(json("/video-uploads", { name: "Clip.mp4", size: bytes.length }))).json();
  await app.request(`/video-uploads/${init.id}/0`, { method: "PUT", body: bytes });
  const { video } = await (await app.request(`/video-uploads/${init.id}/complete`, { method: "POST" })).json();
  const overlayFile = join(directory, "overlay.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=black@0:s=1080x1350,format=rgba", "-frames:v", "1", overlayFile);
  const input = { video: { key: video.key, start: 0, duration: 1 }, overlay: `data:image/png;base64,${(await readFile(overlayFile)).toString("base64")}` };

  // The frame's average washes out the moving grain, leaving the grade's colour.
  async function averageOf(body) {
    const response = await app.request(json("/video-exports", body));
    assert.equal(response.status, 200);
    const output = join(directory, `out-${Math.random()}.mp4`);
    await writeFile(output, Buffer.from(await response.arrayBuffer()));
    return [...execFileSync("ffmpeg", ["-v", "error", "-i", output, "-frames:v", "1", "-vf", "scale=1:1:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"])];
  }
  const plain = await averageOf(input);
  const film = await averageOf({ ...input, grade: "film" });
  const expected = graded(colour);
  plain.forEach((value, channel) => assert.ok(Math.abs(value - colour[channel]) <= 6, `ungraded keeps the source: ${plain}`));
  film.forEach((value, channel) => assert.ok(Math.abs(value - expected[channel]) <= 6, `graded ${film} matches the CSS colour ${expected.map(Math.round)}`));
  assert.equal((await app.request(json("/video-exports", { ...input, grade: "sepia" }))).status, 400);
});
