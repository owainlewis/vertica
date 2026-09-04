import assert from "node:assert/strict";
import test from "node:test";
import { handleApi } from "../worker/api.ts";
import { createSessionCookie, isAuthorised } from "../worker/auth.ts";

/** Enough of D1 to exercise the handlers without a real database. */
function fakeDb() {
  const rows = new Map();
  const assets = new Map();
  const gc = new Map();
  const hooks = {};
  const queries = [];
  const statement = (query) => {
    queries.push(query);
    return ({
    _values: [],
    bind(...values) { this._values = values; return this; },
    async all() {
      if (/SELECT key, not_before AS notBefore FROM media_gc/.test(query)) {
        const [now, claimNow] = this._values;
        return {
          results: [...gc]
            .filter(([, item]) => item.notBefore <= now && (!item.claim || item.claimUntil <= claimNow))
            .slice(0, 25)
            .map(([key, item]) => ({ key, notBefore: item.notBefore })),
        };
      }
      if (/FROM media_assets/.test(query)) {
        let results = [...assets.values()].sort((a, b) =>
          b.updated_at.localeCompare(a.updated_at) || b.key.localeCompare(a.key));
        if (/WHERE updated_at < \?/.test(query)) {
          const [updatedAt, , key, limit] = this._values;
          results = results.filter((row) => row.updated_at < updatedAt || (row.updated_at === updatedAt && row.key < key));
          return { results: results.slice(0, limit) };
        }
        return { results: results.slice(0, this._values[0]) };
      }
      if (/FROM carousels/.test(query)) {
        return { results: [...rows.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)) };
      }
      return { results: [] };
    },
    async first() {
      if (/SELECT 1 AS found FROM carousels/.test(query)) {
        const key = this._values[0];
        const found = [...rows.values()].some((row) => row.config.includes(key)) ||
          (/FROM media_assets/.test(query) && assets.has(key));
        await hooks.afterReferenceCheck?.(key, found);
        return found ? { found: 1 } : null;
      }
      if (/SELECT key FROM media_assets/.test(query)) {
        return assets.has(this._values[0]) ? { key: this._values[0] } : null;
      }
      return rows.get(this._values[0]) ?? null;
    },
    async run() {
      if (/^\s*UPDATE carousels\s+SET cover = json_object/.test(query)) {
        for (const [id, row] of rows) {
          if (row.cover) continue;
          try {
            const parsed = JSON.parse(row.config);
            const slide = parsed.slides?.[0];
            if (!slide || typeof slide !== "object" || Array.isArray(slide)) continue;
            rows.set(id, {
              ...row,
              cover: JSON.stringify({
                slide,
                mark: typeof parsed.mark === "string" ? parsed.mark.slice(0, 30) : "",
              }),
            });
          } catch {
            // Mirrors the json_valid guard in the D1 migration.
          }
        }
        return { meta: { changes: 1 } };
      }
      if (/^\s*INSERT OR IGNORE INTO media_assets/.test(query)) {
        for (const row of rows.values()) {
          try {
            const parsed = JSON.parse(row.config);
            const refs = [parsed.avatar, ...(parsed.slides ?? []).flatMap((slide) => [slide?.background, ...(slide?.images ?? [])])];
            for (const key of refs) {
              if (typeof key !== "string" || !/^img:[a-f0-9]{32}$/.test(key) || assets.has(key)) continue;
              assets.set(key, {
                key, kind: "image", name: "Imported image", mime_type: "",
                width: null, height: null, byte_size: null,
                created_at: row.updated_at, updated_at: row.updated_at,
              });
            }
          } catch {
            // Mirrors the json_valid guard in the migration.
          }
        }
        return { meta: { changes: 1 } };
      }
      if (/^\s*INSERT INTO media_assets/.test(query)) {
        const [key, kind, name, mime_type, width, height, byte_size, created_at, updated_at] = this._values;
        const existing = assets.get(key);
        assets.set(key, {
          key, kind, name, mime_type,
          width: width ?? existing?.width ?? null,
          height: height ?? existing?.height ?? null,
          byte_size: byte_size ?? existing?.byte_size ?? null,
          created_at: existing?.created_at ?? created_at,
          updated_at,
        });
        return { meta: { changes: 1 } };
      }
      if (/^INSERT INTO media_gc/.test(query)) {
        const [key, notBefore, now] = this._values;
        const item = gc.get(key);
        if (!item || !item.claim || item.claimUntil <= now) {
          gc.set(key, { notBefore, claim: null, claimUntil: null });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
      if (/^\s*UPDATE media_gc SET claim = \?, claim_until = \?/.test(query)) {
        const [claim, claimUntil, key, notBefore, now, claimNow] = this._values;
        const item = gc.get(key);
        if (item?.notBefore === notBefore && notBefore <= now && (!item.claim || item.claimUntil <= claimNow)) {
          gc.set(key, { ...item, claim, claimUntil });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
      if (/^UPDATE media_gc SET claim = NULL/.test(query)) {
        const [key, claim] = this._values;
        const item = gc.get(key);
        if (item?.claim === claim) gc.set(key, { ...item, claim: null, claimUntil: null });
        return { meta: { changes: 1 } };
      }
      if (/^UPDATE media_gc SET not_before = \?/.test(query)) {
        const [notBefore, key, claim] = this._values;
        const item = gc.get(key);
        if (item?.claim === claim) gc.set(key, { notBefore, claim: null, claimUntil: null });
        return { meta: { changes: 1 } };
      }
      if (/^DELETE FROM media_gc WHERE key = \? AND claim IS NULL/.test(query)) {
        const [key] = this._values;
        if (!gc.get(key)?.claim) gc.delete(key);
        return { meta: { changes: 1 } };
      }
      if (/^DELETE FROM media_gc/.test(query)) {
        const [key, notBefore, claim] = this._values;
        const item = gc.get(key);
        if (item?.notBefore === notBefore && item.claim === claim) gc.delete(key);
        return { meta: { changes: 1 } };
      }
      if (/^\s*DELETE FROM media_assets/.test(query)) {
        const [key] = this._values;
        if (!assets.has(key)) return { meta: { changes: 0 } };
        if ([...rows.values()].some((row) => row.config.includes(key))) return { meta: { changes: 0 } };
        assets.delete(key);
        return { meta: { changes: 1 } };
      }
      if (/^INSERT INTO carousels/.test(query)) {
        const [id, title, author, template, slide_count, cover_title, cover, config, created_at, updated_at] = this._values;
        // ON CONFLICT DO NOTHING: an existing id is a no-op, and reports zero changes.
        if (rows.has(id)) return { meta: { changes: 0 } };
        rows.set(id, {
          id, title, author, template, slide_count, cover_title, cover, config,
          version: 1, created_at, updated_at,
        });
        return { meta: { changes: 1 } };
      }
      if (/^UPDATE carousels/.test(query)) {
        const [title, author, template, slide_count, cover_title, cover, config, updated_at, id, version] = this._values;
        const existing = rows.get(id);
        // The WHERE clause carries the version, so a stale write matches no row.
        if (!existing || existing.version !== version) return { meta: { changes: 0 } };
        rows.set(id, {
          ...existing,
          title, author, template, slide_count, cover_title, cover, config, updated_at,
          version: existing.version + 1,
        });
        return { meta: { changes: 1 } };
      }
      if (/^DELETE FROM carousels/.test(query)) rows.delete(this._values[0]);
      return { meta: { changes: 1 } };
    },
    });
  };

  return {
    rows,
    assets,
    gc,
    hooks,
    queries,
    prepare: statement,
    batch: async (statements) => Promise.all(statements.map((item) => item.run())),
    exec: async () => {},
  };
}

function fakeMedia() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes, options) {
      objects.set(key, { bytes: new Uint8Array(bytes), metadata: options?.httpMetadata ?? {} });
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return { body: new Response(object.bytes).body, httpMetadata: object.metadata };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

function matureGc(db, key) {
  const item = db.gc.get(key) ?? { claim: null, claimUntil: null };
  db.gc.set(key, { ...item, notBefore: "2000-01-01T00:00:00.000Z" });
}

const config = JSON.stringify({
  title: "AI code review",
  author: "OWAIN LEWIS",
  template: "dark",
  slides: [{ layout: "cover", title: "Four AI reviewers" }, { layout: "content", title: "CodeRabbit" }],
});

function post(body, path = "/api/carousels", method = "POST") {
  return new Request(`http://localhost${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

test("saves a carousel and lists it back with a summary", async () => {
  const env = { DB: fakeDb() };
  const legacyImage = "img:1234567890abcdef1234567890abcdef";
  const malformedLegacyImage = "img:0zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
  env.DB.rows.set("legacy", {
    id: "legacy",
    title: "Legacy carousel",
    author: "OWAIN LEWIS",
    template: "dark",
    slide_count: 1,
    cover_title: "Legacy cover",
    cover: "",
    config: JSON.stringify({
      title: "Legacy carousel",
      mark: "AI ENGINEER",
      slides: [
        { layout: "cover", title: "Legacy cover", body: "Preserve this copy", plate: true, background: legacyImage },
        { layout: "content", title: "Broken legacy key", background: malformedLegacyImage },
      ],
    }),
    version: 1,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
  });

  const created = await handleApi(post({ config }), env);
  assert.equal(created.status, 201);
  const { carousel } = await created.json();
  assert.equal(carousel.title, "AI code review");
  assert.equal(carousel.template, "dark");
  assert.equal(JSON.parse(carousel.cover).slide.title, "Four AI reviewers");
  assert.equal(carousel.slideCount, 2);
  assert.equal(carousel.coverTitle, "Four AI reviewers");

  const listed = await handleApi(new Request("http://localhost/api/carousels"), env);
  const { carousels } = await listed.json();
  assert.equal(carousels.length, 2);
  assert.equal(carousels[0].id, carousel.id);
  const legacyCover = JSON.parse(carousels.find((item) => item.id === "legacy").cover);
  assert.equal(legacyCover.slide.body, "Preserve this copy");
  assert.equal(legacyCover.slide.plate, true);
  assert.equal(legacyCover.mark, "AI ENGINEER");
  assert.equal(env.DB.assets.get(legacyImage)?.name, "Imported image", "saved backgrounds are backfilled into the library");
  assert.equal(env.DB.assets.has(malformedLegacyImage), false, "malformed legacy keys are not exposed as broken media items");
  // The list view must not ship every slide of every deck to the dashboard.
  assert.equal(carousels[0].config, undefined);
  const listQuery = env.DB.queries.find((query) => /^SELECT id,/.test(query));
  assert.ok(listQuery);
  assert.doesNotMatch(listQuery, /\bconfig\b/);
});

test("stores reusable library images and blocks deletion while they are in use", async () => {
  const media = fakeMedia();
  const env = { DB: fakeDb(), MEDIA: media };
  const key = "img:9876543210abcdef9876543210abcdef";
  const upload = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: "data:image/webp;base64,AQID",
    headers: {
      "content-type": "text/plain",
      "x-media-library": "1",
      "x-media-name": encodeURIComponent("Cinematic office"),
      "x-media-width": "1080",
      "x-media-height": "1350",
    },
  }), env);
  assert.equal(upload.status, 200);
  assert.equal(env.DB.gc.has(key), false, "library media is removed from the orphan queue");

  const listed = await handleApi(new Request("http://localhost/api/media"), env);
  const body = await listed.json();
  assert.deepEqual(body.media.map(({ name, kind, mimeType, width, height, byteSize }) => ({ name, kind, mimeType, width, height, byteSize })), [{
    name: "Cinematic office",
    kind: "image",
    mimeType: "image/webp",
    width: 1080,
    height: 1350,
    byteSize: 3,
  }]);

  const withLibraryImage = JSON.stringify({
    ...JSON.parse(config),
    slides: [{ layout: "cover", title: "Uses library", background: key }],
  });
  const carousel = (await (await handleApi(post({ config: withLibraryImage }), env)).json()).carousel;
  const inUse = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(key)}`, { method: "DELETE" }), env);
  assert.equal(inUse.status, 409);
  assert.match((await inUse.json()).error, /used by a carousel/i);
  assert.equal(env.DB.assets.has(key), true);
  assert.equal(media.objects.size, 1);

  await handleApi(new Request(`http://localhost/api/carousels/${carousel.id}`, { method: "DELETE" }), env);
  const removed = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(key)}`, { method: "DELETE" }), env);
  assert.equal(removed.status, 200);
  assert.equal(env.DB.assets.has(key), false);
  assert.equal(media.objects.size, 1, "bytes remain during the deletion grace period");
  matureGc(env.DB, key);
  await handleApi(new Request("http://localhost/api/media"), env);
  assert.equal(media.objects.size, 0, "unreferenced bytes are collected after the grace period");
});

test("paginates the media library without hiding older assets", async () => {
  const env = { DB: fakeDb(), MEDIA: fakeMedia() };
  for (let index = 0; index < 65; index += 1) {
    const suffix = index.toString(16).padStart(32, "0");
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
    env.DB.assets.set(`img:${suffix}`, {
      key: `img:${suffix}`,
      kind: "image",
      name: `Image ${index}`,
      mime_type: "image/webp",
      width: 1080,
      height: 1350,
      byte_size: 3,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  const first = await (await handleApi(new Request("http://localhost/api/media"), env)).json();
  assert.equal(first.media.length, 60);
  assert.ok(first.nextCursor);
  const second = await (await handleApi(new Request(`http://localhost/api/media?cursor=${encodeURIComponent(first.nextCursor)}`), env)).json();
  assert.equal(second.media.length, 5);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.media, ...second.media].map((asset) => asset.key)).size, 65);
});

test("persists image bytes through the media API", async () => {
  const media = fakeMedia();
  const env = { DB: fakeDb(), MEDIA: media };
  const key = "img:0123456789abcdef0123456789abcdef";
  const upload = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: "data:image/png;base64,AQID",
    headers: { "content-type": "text/plain" },
  }), env);

  assert.equal(upload.status, 200);
  assert.equal(media.objects.size, 1);

  const download = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(key)}`), env);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "image/png");
  assert.equal(download.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.deepEqual([...new Uint8Array(await download.arrayBuffer())], [1, 2, 3]);

  // New pickers exclude SVG, but an older carousel may still need to persist one
  // during migration. Keeping that storage path open prevents its next edit failing.
  const legacySvgKey = "img:fedcba9876543210fedcba9876543210";
  const legacySvg = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(legacySvgKey)}`, {
    method: "PUT",
    body: "data:image/svg+xml;base64,PHN2Zy8+",
    headers: { "content-type": "text/plain" },
  }), env);
  assert.equal(legacySvg.status, 200);
  const legacySvgDownload = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(legacySvgKey)}`), env);
  assert.equal(legacySvgDownload.headers.get("content-type"), "image/svg+xml");
  const librarySvg = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(legacySvgKey)}`, {
    method: "PUT",
    body: "data:image/svg+xml;base64,PHN2Zy8+",
    headers: { "x-media-library": "1" },
  }), env);
  assert.equal(librarySvg.status, 400);
  assert.equal(env.DB.assets.has(legacySvgKey), false);

  const invalid = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: "data:text/plain;base64,AQID",
  }), env);
  assert.equal(invalid.status, 400);

  const oversized = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: "data:image/png;base64,AQID",
    headers: { "content-length": "20000000" },
  }), env);
  assert.equal(oversized.status, 400);

  const notConfigured = await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(key)}`), { DB: fakeDb() });
  assert.equal(notConfigured.status, 503);
});

test("reclaims unreferenced media without deleting shared images", async () => {
  const media = fakeMedia();
  const env = { DB: fakeDb(), MEDIA: media };
  const key = "img:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: "data:image/png;base64,AQID",
  }), env);
  assert.ok(env.DB.gc.get(key).notBefore > new Date().toISOString(), "every upload starts an abandonment grace period");
  matureGc(env.DB, key);
  await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: "data:image/png;base64,AQID",
  }), env);
  await handleApi(new Request("http://localhost/api/carousels"), env);
  assert.equal(media.objects.size, 1, "re-uploading a matured hash refreshes it before collection");

  const withImage = JSON.stringify({
    ...JSON.parse(config),
    slides: [{ layout: "cover", title: "Shared", background: key }],
  });
  const first = (await (await handleApi(post({ config: withImage }), env)).json()).carousel;
  const second = (await (await handleApi(post({ config: withImage }), env)).json()).carousel;

  const withoutImage = JSON.stringify({
    ...JSON.parse(config),
    slides: [{ layout: "cover", title: "No image" }],
  });
  await handleApi(post({ config: withoutImage, version: first.version }, `/api/carousels/${first.id}`, "PUT"), env);
  matureGc(env.DB, key);
  await handleApi(new Request("http://localhost/api/carousels"), env);
  assert.equal(media.objects.size, 1, "another carousel still references the content hash");

  await handleApi(new Request(`http://localhost/api/carousels/${second.id}`, { method: "DELETE" }), env);
  matureGc(env.DB, key);
  await handleApi(new Request("http://localhost/api/carousels"), env);
  assert.equal(media.objects.size, 0, "the last removed reference lets the queued object be reclaimed");

  const failedKey = "img:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(failedKey)}`, {
    method: "PUT",
    body: "data:image/png;base64,BAUG",
  }), env);
  const failedConfig = JSON.stringify({
    ...JSON.parse(config),
    slides: [{ layout: "cover", title: "Stale save", background: failedKey }],
  });
  const stale = await handleApi(post({ config: failedConfig, version: 999 }, `/api/carousels/${first.id}`, "PUT"), env);
  assert.equal(stale.status, 409);
  matureGc(env.DB, failedKey);
  await handleApi(new Request("http://localhost/api/carousels"), env);
  assert.equal(media.objects.size, 0, "a failed save cannot strand its newly uploaded image");

  const abandonedKey = "img:cccccccccccccccccccccccccccccccc";
  await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(abandonedKey)}`, {
    method: "PUT",
    body: "data:image/png;base64,BwgJ",
  }), env);
  matureGc(env.DB, abandonedKey);
  await handleApi(new Request("http://localhost/api/carousels"), env);
  assert.equal(media.objects.size, 0, "an upload abandoned before any config save is eventually reclaimed");
  const missingAdoption = JSON.stringify({
    ...JSON.parse(config),
    slides: [{ layout: "cover", title: "Cached but deleted", background: abandonedKey }],
  });
  const missingAdoptionResponse = await handleApi(post({ config: missingAdoption }), env);
  assert.equal(missingAdoptionResponse.status, 400);
  assert.match((await missingAdoptionResponse.json()).error, /image was removed/i);

  const racingKey = "img:dddddddddddddddddddddddddddddddd";
  await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(racingKey)}`, {
    method: "PUT",
    body: "data:image/png;base64,CgsM",
  }), env);
  matureGc(env.DB, racingKey);

  let releaseDelete;
  let reportDeleteStarted;
  const deleteStarted = new Promise((resolve) => { reportDeleteStarted = resolve; });
  const deleteGate = new Promise((resolve) => { releaseDelete = resolve; });
  const realDelete = media.delete.bind(media);
  media.delete = async (objectKey) => {
    if (objectKey.endsWith(racingKey.slice(4))) {
      reportDeleteStarted();
      await deleteGate;
    }
    await realDelete(objectKey);
  };

  const collecting = handleApi(new Request("http://localhost/api/carousels"), env);
  await deleteStarted;
  let uploadFinished = false;
  const reuploading = handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(racingKey)}`, {
    method: "PUT",
    body: "data:image/png;base64,CgsM",
  }), env).then((response) => { uploadFinished = true; return response; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(uploadFinished, false, "an upload waits while the collector owns the deletion lease");
  releaseDelete();
  await Promise.all([collecting, reuploading]);
  assert.ok(media.objects.has(`images/${racingKey.slice(4)}`), "the waiting upload writes after deletion completes");

  const adoptionKey = "img:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(adoptionKey)}`, {
    method: "PUT",
    body: "data:image/png;base64,DQ4P",
  }), env);
  matureGc(env.DB, adoptionKey);

  let releaseAdoptionDelete;
  let reportAdoptionDelete;
  const adoptionDeleteStarted = new Promise((resolve) => { reportAdoptionDelete = resolve; });
  const adoptionDeleteGate = new Promise((resolve) => { releaseAdoptionDelete = resolve; });
  media.delete = async (objectKey) => {
    if (objectKey.endsWith(adoptionKey.slice(4))) {
      reportAdoptionDelete();
      await adoptionDeleteGate;
    }
    await realDelete(objectKey);
  };

  const adoptionCollection = handleApi(new Request("http://localhost/api/carousels"), env);
  await adoptionDeleteStarted;
  const adoptionConfig = JSON.stringify({
    ...JSON.parse(config),
    slides: [{ layout: "cover", title: "Adopt while deleting", background: adoptionKey }],
  });
  let adoptionFinished = false;
  const adopting = handleApi(post({ config: adoptionConfig }), env)
    .then((response) => { adoptionFinished = true; return response; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(adoptionFinished, false, "a config cannot adopt a key during its deletion lease");
  releaseAdoptionDelete();
  const [, adoptionResponse] = await Promise.all([adoptionCollection, adopting]);
  assert.equal(adoptionResponse.status, 400);
  assert.match((await adoptionResponse.json()).error, /image was removed/i);

  const removalKey = "img:ffffffffffffffffffffffffffffffff";
  await handleApi(new Request(`http://localhost/api/media/${encodeURIComponent(removalKey)}`, {
    method: "PUT",
    body: "data:image/png;base64,EBES",
  }), env);
  const removalConfig = JSON.stringify({
    ...JSON.parse(config),
    slides: [{ layout: "cover", title: "Remove during check", background: removalKey }],
  });
  const removalCarousel = (await (await handleApi(post({ config: removalConfig }), env)).json()).carousel;
  matureGc(env.DB, removalKey);

  let releaseReferenceCheck;
  let reportReferenceCheck;
  const referenceChecked = new Promise((resolve) => { reportReferenceCheck = resolve; });
  const referenceGate = new Promise((resolve) => { releaseReferenceCheck = resolve; });
  env.DB.hooks.afterReferenceCheck = async (key, found) => {
    if (key === removalKey && found) {
      reportReferenceCheck();
      await referenceGate;
    }
  };
  const referenceCollection = handleApi(new Request("http://localhost/api/carousels"), env);
  await referenceChecked;
  const removedDuringClaim = await handleApi(post({
    config: withoutImage,
    version: removalCarousel.version,
  }, `/api/carousels/${removalCarousel.id}`, "PUT"), env);
  assert.equal(removedDuringClaim.status, 200);
  releaseReferenceCheck();
  await referenceCollection;
  delete env.DB.hooks.afterReferenceCheck;
  assert.ok(env.DB.gc.has(removalKey), "a referenced claim is postponed when concurrent removal cannot queue");
  matureGc(env.DB, removalKey);
  await handleApi(new Request("http://localhost/api/carousels"), env);
  assert.equal(media.objects.has(`images/${removalKey.slice(4)}`), false);
});

test("updating keeps the original creation time and bumps the version", async () => {
  const env = { DB: fakeDb() };
  const { carousel } = await (await handleApi(post({ config }), env)).json();
  assert.equal(carousel.version, 1);

  const renamed = JSON.stringify({ ...JSON.parse(config), title: "Renamed" });
  const updated = await handleApi(post({ config: renamed, version: carousel.version }, `/api/carousels/${carousel.id}`, "PUT"), env);
  const body = await updated.json();

  assert.equal(body.carousel.title, "Renamed");
  assert.equal(body.carousel.createdAt, carousel.createdAt);
  assert.equal(body.carousel.version, 2, "every write moves the version on");
  assert.equal(env.DB.rows.size, 1, "an update must not create a second row");
});

test("a save built on a stale version is refused rather than applied", async () => {
  const env = { DB: fakeDb() };
  const { carousel } = await (await handleApi(post({ config }), env)).json();

  // Two editors both open the deck at version 1. The first one saves.
  const first = JSON.stringify({ ...JSON.parse(config), title: "Saved first" });
  const won = await handleApi(post({ config: first, version: 1 }, `/api/carousels/${carousel.id}`, "PUT"), env);
  assert.equal(won.status, 200);

  // The second still thinks it is at version 1. This is the write that used to
  // silently destroy the first one's work.
  const second = JSON.stringify({ ...JSON.parse(config), title: "Saved second" });
  const lost = await handleApi(post({ config: second, version: 1 }, `/api/carousels/${carousel.id}`, "PUT"), env);
  assert.equal(lost.status, 409);
  assert.match((await lost.json()).error, /changed somewhere else/);

  const { carousel: current } = await (await handleApi(new Request(`http://localhost/api/carousels/${carousel.id}`), env)).json();
  assert.equal(current.title, "Saved first", "the earlier write must survive");

  // Reloading gives the current version, and the save then goes through.
  const retried = await handleApi(post({ config: second, version: current.version }, `/api/carousels/${carousel.id}`, "PUT"), env);
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).carousel.title, "Saved second");
});

test("a PUT with no version at all is refused", async () => {
  const env = { DB: fakeDb() };
  const { carousel } = await (await handleApi(post({ config }), env)).json();
  const blind = await handleApi(post({ config }, `/api/carousels/${carousel.id}`, "PUT"), env);
  assert.equal(blind.status, 409);
});

test("rejects payloads that would not render", async () => {
  const env = { DB: fakeDb() };

  const noSlides = await handleApi(post({ config: JSON.stringify({ slides: [] }) }), env);
  assert.equal(noSlides.status, 400);
  assert.match((await noSlides.json()).error, /at least one slide/);

  const notJson = await handleApi(post({ config: "not json" }), env);
  assert.equal(notJson.status, 400);

  const huge = await handleApi(post({ config: JSON.stringify({ slides: [{ title: "x".repeat(500_000) }] }) }), env);
  assert.equal(huge.status, 400);
  assert.match((await huge.json()).error, /too large/);
});

test("deletes a carousel", async () => {
  const env = { DB: fakeDb() };
  const { carousel } = await (await handleApi(post({ config }), env)).json();

  const removed = await handleApi(new Request(`http://localhost/api/carousels/${carousel.id}`, { method: "DELETE" }), env);
  assert.equal(removed.status, 200);
  assert.equal(env.DB.rows.size, 0);
});

test("a configured secret closes the API to unsigned requests", async () => {
  const env = { DB: fakeDb(), APP_SECRET: "hunter2" };

  const blocked = await handleApi(new Request("http://localhost/api/carousels"), env);
  assert.equal(blocked.status, 401);

  const wrong = await handleApi(post({ password: "nope" }, "/api/session"), env);
  assert.equal(wrong.status, 401);

  const right = await handleApi(post({ password: "hunter2" }, "/api/session"), env);
  assert.equal(right.status, 200);
  const cookie = right.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);

  const allowed = await handleApi(
    new Request("http://localhost/api/carousels", { headers: { cookie: cookie.split(";")[0] } }),
    env,
  );
  assert.equal(allowed.status, 200);
});

test("a session cookie signed with a different secret is refused", async () => {
  const forged = await createSessionCookie("the-wrong-secret");
  const request = new Request("http://localhost/api/carousels", { headers: { cookie: forged.split(";")[0] } });

  assert.equal(await isAuthorised(request, "the-real-secret"), false);
  assert.equal(await isAuthorised(request, "the-wrong-secret"), true);
});

test("with no secret set the API is open, which is what local development wants", async () => {
  assert.equal(await isAuthorised(new Request("http://localhost/api/carousels"), undefined), true);
});

test("an unexpected database fault does not leak its message to the client", async () => {
  const env = { DB: fakeDb() };
  const { carousel } = await (await handleApi(post({ config }), env)).json();
  // A SQL error carries internal detail. The client gets a 500 and a generic line.
  env.DB.prepare = () => ({
    bind() { return this; },
    async all() { return { results: [] }; },
    async first() { throw new Error("D1_ERROR: no such column: secret_internal_detail"); },
    async run() { throw new Error("D1_ERROR: no such column: secret_internal_detail"); },
  });

  const response = await handleApi(post({ config, version: carousel.version }, `/api/carousels/${carousel.id}`, "PUT"), env);
  assert.equal(response.status, 500);
  const { error } = await response.json();
  assert.doesNotMatch(error, /D1_ERROR|secret_internal_detail/);
});

test("a bad payload is still a 400, not a 500", async () => {
  const env = { DB: fakeDb() };
  const response = await handleApi(post({ config: JSON.stringify({ slides: [] }) }), env);
  assert.equal(response.status, 400);
});

test("updating a carousel that has been deleted reports 404", async () => {
  const env = { DB: fakeDb() };
  const { carousel } = await (await handleApi(post({ config }), env)).json();
  env.DB.rows.clear();

  const response = await handleApi(post({ config, version: carousel.version }, `/api/carousels/${carousel.id}`, "PUT"), env);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /gone/);
});

test("the session cookie is only marked Secure over https", async () => {
  const env = { DB: fakeDb(), APP_SECRET: "hunter2" };

  const plain = await handleApi(post({ password: "hunter2" }, "/api/session"), env);
  assert.doesNotMatch(plain.headers.get("set-cookie"), /Secure/, "local http must still be able to sign in");

  const secure = await handleApi(
    new Request("https://vertica.example/api/session", {
      method: "POST", body: JSON.stringify({ password: "hunter2" }),
      headers: { "content-type": "application/json" },
    }),
    env,
  );
  const cookie = secure.headers.get("set-cookie");
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
});

test("a password of the wrong length is rejected like any other", async () => {
  const env = { DB: fakeDb(), APP_SECRET: "hunter2" };
  for (const password of ["", "h", "hunter", "hunter2!", "wrong77"]) {
    const response = await handleApi(post({ password }, "/api/session"), env);
    assert.equal(response.status, 401, `${JSON.stringify(password)} must not authenticate`);
  }
  assert.equal((await handleApi(post({ password: "hunter2" }, "/api/session"), env)).status, 200);
});
