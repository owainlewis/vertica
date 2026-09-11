import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./component-loader.mjs", import.meta.url);
const { loadCarousel } = await import("../app/api-client.ts");

test("loading legacy slides assigns stable unique IDs without changing stored content", async (t) => {
  const config = JSON.stringify({ title: "Legacy", slides: [
    { title: "Missing ID", layout: "cover" },
    { id: "legacy-slide-1", title: "Reserved ID", layout: "content" },
    { id: "legacy-slide-1-1", title: "Reserved fallback", layout: "note" },
    { id: "same", title: "First explicit ID", layout: "content" },
    { id: " same ", title: "Duplicate explicit ID", layout: "content" },
    { id: " ", title: "Blank ID", layout: "content" },
    ...Array.from({ length: 15 }, (_, i) => ({ title: `Older slide ${i}`, layout: "content" })),
  ] });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/carousels/legacy");
    assert.equal(init.method, undefined, "loading never writes a migration");
    return Response.json({ carousel: { id: "legacy", version: 1, config } });
  });
  const first = await loadCarousel("legacy");
  const second = await loadCarousel("legacy");
  const ids = first.config.slides.map(({ id }) => id);
  assert.deepEqual(ids, second.config.slides.map(({ id }) => id));
  assert.equal(new Set(ids).size, 21);
  assert.ok(ids.every((id) => typeof id === "string" && id.trim()));
  assert.equal(ids[1], "legacy-slide-1");
  assert.equal(ids[2], "legacy-slide-1-1");
  assert.equal(ids[3], "same");
  assert.equal(first.summary.config, config);
  assert.deepEqual(first.config.slides.map(({ title }) => title), JSON.parse(config).slides.map(({ title }) => title));
});
