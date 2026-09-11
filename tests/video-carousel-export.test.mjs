import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderVideoCarousel } from "../app/video-carousel-export.ts";

const slides = [0, 1, 2].map((index) => ({
  id: String(index), layout: "content", title: `Slide ${index + 1}`, body: "",
  video: { key: `vid:${String(index).repeat(32)}`, start: index, duration: 2, sourceDuration: 10 },
}));

test("video carousel exports every clip sequentially with ordered names and exact bytes", async (t) => {
  const progress = [];
  const order = [];
  let active = 0;
  const zip = await renderVideoCarousel("my-deck", slides, async (index, clip) => {
    assert.equal(active++, 0, "one encoder at a time");
    assert.equal(clip.start, index);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    order.push(index);
    return new Blob([`clip-${index}`]);
  }, (message) => progress.push(message));
  assert.deepEqual(order, [0, 1, 2]);
  assert.match(progress[0], /1 of 3/);
  assert.match(progress[2], /3 of 3/);
  assert.match(progress.at(-1), /Packing/);
  const directory = mkdtempSync(join(tmpdir(), "vertica-video-zip-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "deck.zip");
  writeFileSync(path, Buffer.from(await zip.arrayBuffer()));
  const contents = execFileSync("python3", ["-c", "import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))", path]);
  assert.deepEqual(JSON.parse(contents), { "my-deck-01.mp4": "clip-0", "my-deck-02.mp4": "clip-1", "my-deck-03.mp4": "clip-2" });
});

test("missing footage and invalid intervals fail before any rendering", async () => {
  for (const [video, error] of [
    [undefined, /Slide 2 needs a video/],
    [{ ...slides[1].video, start: 9 }, /Slide 2: The clip must fit/],
    [{ ...slides[1].video, sourceDuration: undefined }, /Slide 2: Open this slide/],
  ]) {
    let calls = 0;
    await assert.rejects(renderVideoCarousel("deck", [slides[0], { ...slides[1], video }], async () => { calls++; return new Blob(); }, () => {}), error);
    assert.equal(calls, 0);
  }
});

test("a failed render stops the batch and names the slide instead of returning a partial ZIP", async () => {
  const rendered = [];
  await assert.rejects(renderVideoCarousel("deck", slides, async (index) => {
    rendered.push(index);
    if (index === 1) throw new Error("Encoder is busy. Try again.");
    return new Blob(["clip"]);
  }, () => {}), /Slide 2 could not be exported.*Encoder is busy/);
  assert.deepEqual(rendered, [0, 1]);
});

test("large video archives stop before allocating another buffer", async () => {
  await assert.rejects(renderVideoCarousel("deck", slides, async () => ({
    size: 257 * 1024 * 1024,
    arrayBuffer: () => { throw new Error("Should not allocate"); },
  }), () => {}), /exceeds 256 MB/);
});
