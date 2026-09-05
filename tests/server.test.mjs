import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GcsBucket, LocalBucket } from "../server/bucket.ts";
import { createServer, serverOptionsFromEnv } from "../server/index.ts";

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

test("production refuses ephemeral storage and an open API", () => {
  assert.throws(
    () => serverOptionsFromEnv({ NODE_ENV: "production" }),
    /BUCKET and APP_SECRET must be set in production/,
  );
  assert.throws(
    () => serverOptionsFromEnv({ NODE_ENV: "production", BUCKET: "vertica-store" }),
    /APP_SECRET must be set in production/,
  );
  assert.throws(
    () => serverOptionsFromEnv({ NODE_ENV: "production", APP_SECRET: "a-long-secret" }),
    /BUCKET must be set in production/,
  );

  const configured = serverOptionsFromEnv({
    NODE_ENV: "production",
    BUCKET: "vertica-store",
    APP_SECRET: "a-long-secret",
  });
  assert.ok(configured.bucket instanceof GcsBucket);
  assert.equal(configured.secret, "a-long-secret");
});

test("development keeps the local defaults", () => {
  const configured = serverOptionsFromEnv({});
  assert.ok(configured.bucket instanceof LocalBucket);
  assert.equal(configured.secret, undefined);
  assert.equal(configured.dist, "dist");
});
