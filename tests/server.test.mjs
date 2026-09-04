import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalBucket } from "../server/bucket.ts";
import { createServer } from "../server/index.ts";

test("serves the built app for any page and the API under /api", async () => {
  const app = createServer({ bucket: new LocalBucket(mkdtempSync(join(tmpdir(), "vertica-"))), secret: undefined, dist: "dist" });
  for (const path of ["/", "/?id=abc", "/anything"]) {
    const response = await app.request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /<title>Vertica/);
  }
  const api = await app.request("/api/session");
  assert.deepEqual(await api.json(), { gated: false, authorised: true });
});
