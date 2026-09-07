import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GcsBucket, LocalBucket, PreconditionError } from "../server/bucket.ts";

const options = { contentType: "text/plain" };
const bytes = (text) => new TextEncoder().encode(text);

async function local(t) {
  const directory = await mkdtemp(join(tmpdir(), "vertica-bucket-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { bucket: new LocalBucket(directory), directory };
}

test("local bucket rejects escaping keys through every operation", async (t) => {
  const { bucket, directory } = await local(t);
  for (const key of ["../outside", join(directory, "..", "outside"), "nested/../../outside"]) {
    for (const operation of [() => bucket.get(key), () => bucket.head(key), () => bucket.put(key, bytes("unsafe"), options), () => bucket.delete(key), () => bucket.list(key)]) {
      await assert.rejects(operation, /Invalid bucket key/);
    }
  }
});

test("local reads wait for writes and return matching bytes and metadata", async (t) => {
  const { bucket, directory } = await local(t);
  const initial = await bucket.put("deck", bytes("old"), { ...options, custom: { title: "old" } });
  const second = new LocalBucket(directory);
  const write = bucket.put("deck", bytes("new"), { ...options, custom: { title: "new" }, ifGeneration: initial.generation });
  const read = second.get("deck");
  const [saved, fetched] = await Promise.all([write, read]);
  assert.equal(new TextDecoder().decode(fetched.bytes), "new");
  assert.equal(fetched.meta.custom.title, "new");
  assert.equal(fetched.meta.generation, saved.generation);
  await assert.rejects(second.put("deck", bytes("stale"), { ...options, ifGeneration: initial.generation }), PreconditionError);
  assert.ok((await second.put("deck", bytes("retry"), { ...options, ifGeneration: saved.generation })).generation > saved.generation);
});

// Exercise our adapter with deterministic object replacements at SDK boundaries.
function cloud(file) {
  const bucket = Object.create(GcsBucket.prototype);
  bucket.ready = Promise.resolve({ file });
  return bucket;
}

const metadata = (generation, title) => ({ generation: String(generation), contentType: "text/plain", metadata: { title }, updated: "2026-09-07T12:00:00Z" });
const missing = () => Object.assign(new Error("No such generation"), { code: 404 });

test("cloud reads pin the downloaded content to its metadata generation", async () => {
  let current = 1;
  const bucket = cloud((_key, config = {}) => ({
    async getMetadata() { const result = metadata(current, `v${current}`); current = 2; return [result]; },
    async download() { await Promise.resolve(); return [bytes(`v${config.generation ?? current}`)]; },
  }));
  const object = await bucket.get("deck");
  assert.equal(new TextDecoder().decode(object.bytes), `v${object.meta.generation}`);
  assert.equal(object.meta.custom.title, "v1");
});

test("cloud reads retry when a pinned generation is replaced before download", async () => {
  let current = 1;
  const bucket = cloud((_key, config = {}) => ({
    async getMetadata() { return [metadata(current, `v${current}`)]; },
    async download() {
      if (String(config.generation) === "1") { current = 2; throw missing(); }
      return [bytes(`v${current}`)];
    },
  }));
  const object = await bucket.get("deck");
  assert.equal(object.meta.generation, 2);
  assert.equal(new TextDecoder().decode(object.bytes), "v2");
});

test("cloud reads distinguish deletion from storage failures and bound retries", async () => {
  const gone = cloud(() => ({ async getMetadata() { throw missing(); }, async download() { throw missing(); } }));
  assert.equal(await gone.get("deck"), null);
  const denied = cloud(() => ({ async getMetadata() { throw new Error("Denied"); }, async download() { throw new Error("Denied"); } }));
  await assert.rejects(denied.get("deck"), /Denied/);
  let reads = 0;
  const busy = cloud(() => ({ async getMetadata() { reads += 1; return [metadata(reads, "busy")]; }, async download() { throw missing(); } }));
  await assert.rejects(busy.get("deck"), /changed repeatedly/);
  assert.equal(reads, 3);
});

test("cloud writes return their upload generation even if another writer immediately replaces it", async () => {
  let current = 1;
  const bucket = cloud(() => ({
    metadata: {},
    async save(_data, config) {
      if (config.preconditionOpts.ifGenerationMatch !== current) throw Object.assign(new Error("Stale"), { code: 412 });
      this.metadata = metadata(++current, "our write");
      current += 1; // Another editor writes before our save promise resolves.
    },
    async getMetadata() { return [metadata(current, "other editor")]; },
  }));
  const saved = await bucket.put("deck", bytes("our write"), { ...options, ifGeneration: 1 });
  assert.equal(saved.generation, 2);
  assert.equal(saved.custom.title, "our write");
  await assert.rejects(bucket.put("deck", bytes("stale overwrite"), { ...options, ifGeneration: saved.generation }), PreconditionError);
});
