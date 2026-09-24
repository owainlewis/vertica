import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApi } from "../server/api.ts";
import { createSessionCookie } from "../server/auth.ts";
import { LocalBucket } from "../server/bucket.ts";

function api(options = {}) {
  const bucket = new LocalBucket(mkdtempSync(join(tmpdir(), "vertica-")));
  return { app: createApi({ bucket, ...options }), bucket };
}

const deck = (title = "AI code review") => JSON.stringify({
  title,
  author: "Owain Lewis",
  mark: "Reviews",
  slides: [{ layout: "cover", title: "Four AI reviewers" }, { layout: "content", title: "CodeRabbit" }],
});

const jsonRequest = (path, body, method = "POST") =>
  new Request(`http://localhost${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const KEY = "img:1234567890abcdef1234567890abcdef";

test("POST and PUT reject oversized decks and duplicate normalized IDs without storing them", async () => {
  const { app } = api();
  const created = await app.request(jsonRequest("/carousels", { config: deck() }));
  const { carousel } = await created.json();
  const cases = [
    { slides: Array.from({ length: 21 }, (_, i) => ({ id: `slide-${i}`, title: "Slide" })), error: /20 slides/ },
    { slides: [{ id: "same", title: "First" }, { id: " same ", title: "Second" }], error: /duplicate id/ },
  ];
  for (const { slides, error } of cases) {
    for (const method of ["POST", "PUT"]) {
      const path = method === "POST" ? "/carousels" : `/carousels/${carousel.id}`;
      const response = await app.request(jsonRequest(path, { config: JSON.stringify({ slides }), version: carousel.version }, method));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, error);
    }
  }
  const list = await (await app.request("/carousels")).json();
  assert.equal(list.carousels.length, 1);
  const stored = (await (await app.request(`/carousels/${carousel.id}`)).json()).carousel;
  assert.equal(stored.config, deck());
  assert.equal(stored.version, carousel.version);
});

test("API writes preserve older documents without explicit slide IDs", async () => {
  const { app } = api();
  const config = JSON.stringify({ slides: [{ layout: "cover" }, { layout: "content" }] });
  const response = await app.request(jsonRequest("/carousels", { config }));
  assert.equal(response.status, 201);
  const { carousel } = await response.json();
  const updated = await app.request(jsonRequest(`/carousels/${carousel.id}`, { config, version: carousel.version }, "PUT"));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).carousel.config, config);
});

test("persists the theme in the deck and gallery cover, including a switch back to Editorial", async () => {
  const { app } = api();
  const config = { ...JSON.parse(deck()), theme: "ai-engineer" };
  const response = await app.request(jsonRequest("/carousels", { config: JSON.stringify(config) }));
  assert.equal(response.status, 201);
  const { carousel } = await response.json();
  const fetched = await (await app.request(`/carousels/${carousel.id}`)).json();
  assert.equal(JSON.parse(fetched.carousel.config).theme, "ai-engineer");
  const list = await (await app.request("/carousels")).json();
  assert.equal(JSON.parse(list.carousels[0].cover).theme, "ai-engineer");
  const updated = await app.request(jsonRequest(`/carousels/${carousel.id}`, {
    version: carousel.version, config: JSON.stringify({ ...config, theme: "editorial" }),
  }, "PUT"));
  assert.equal(updated.status, 200);
  const next = (await updated.json()).carousel;
  assert.equal(JSON.parse(next.config).theme, "editorial");
  assert.equal(JSON.parse(next.cover).theme, undefined);
});

test("Cinematic video intent and slide labels survive save, reload and gallery listing", async () => {
  const { app } = api();
  const config = { ...JSON.parse(deck()), theme: "cinematic", format: "video" };
  config.slides[0].label = "Rule 01";
  const created = await app.request(jsonRequest("/carousels", { config: JSON.stringify(config) }));
  assert.equal(created.status, 201);
  const { carousel } = await created.json();
  const fetched = await (await app.request(`/carousels/${carousel.id}`)).json();
  assert.deepEqual(JSON.parse(fetched.carousel.config), config);
  const list = await (await app.request("/carousels")).json();
  const cover = JSON.parse(list.carousels[0].cover);
  assert.equal(cover.format, "video");
  assert.equal(cover.theme, "cinematic");
  assert.equal(cover.slide.label, "Rule 01");
});

test("saves a carousel, lists it, and refuses a stale write", async () => {
  const { app } = api();
  const created = await app.request(jsonRequest("/carousels", { config: deck() }));
  assert.equal(created.status, 201);
  const { carousel } = await created.json();
  assert.equal(carousel.title, "AI code review");
  assert.equal(carousel.slideCount, 2);
  assert.ok(carousel.version > 0);
  assert.equal(JSON.parse(carousel.cover).mark, "Reviews");

  const list = await (await app.request("/carousels")).json();
  assert.deepEqual(list.carousels.map((row) => row.id), [carousel.id]);
  assert.equal(list.carousels[0].coverTitle, "Four AI reviewers");

  const updated = await app.request(jsonRequest(`/carousels/${carousel.id}`, { version: carousel.version, config: deck("Renamed") }, "PUT"));
  assert.equal(updated.status, 200);
  const next = (await updated.json()).carousel;
  assert.equal(next.title, "Renamed");
  assert.ok(next.version > carousel.version, "the version moves on every write");
  assert.equal(next.createdAt, carousel.createdAt, "creation time survives an update");

  const stale = await app.request(jsonRequest(`/carousels/${carousel.id}`, { version: carousel.version, config: deck("Stale") }, "PUT"));
  assert.equal(stale.status, 409);
  const unversioned = await app.request(jsonRequest(`/carousels/${carousel.id}`, { config: deck("No version") }, "PUT"));
  assert.equal(unversioned.status, 409);

  const fetched = await (await app.request(`/carousels/${carousel.id}`)).json();
  assert.equal(JSON.parse(fetched.carousel.config).title, "Renamed");

  assert.equal((await app.request(new Request(`http://localhost/carousels/${carousel.id}`, { method: "DELETE" }))).status, 200);
  assert.equal((await app.request(`/carousels/${carousel.id}`)).status, 404);
  const gone = await app.request(jsonRequest(`/carousels/${carousel.id}`, { version: next.version, config: deck() }, "PUT"));
  assert.equal(gone.status, 404);
});

test("rejects payloads that would not render, without leaking internals", async () => {
  const { app } = api();
  assert.equal((await app.request(jsonRequest("/carousels", { config: "not json" }))).status, 400);
  assert.equal((await app.request(jsonRequest("/carousels", { config: JSON.stringify({ slides: [] }) }))).status, 400);
  assert.equal((await app.request(jsonRequest("/carousels", { config: "x".repeat(500_000) }))).status, 400);
  assert.equal((await app.request("/nowhere")).status, 404);
});

test("stores media, serves it back, and protects images a deck still uses", async () => {
  const { app } = api();
  const put = (headers = {}) => app.request(new Request(`http://localhost/media/${encodeURIComponent(KEY)}`, {
    method: "PUT", body: PIXEL, headers: { "content-type": "text/plain", ...headers },
  }));
  assert.equal((await put()).status, 200);
  assert.deepEqual((await (await app.request("/media")).json()).media, [], "a plain upload is not a library item");

  assert.equal((await put({ "x-media-library": "1", "x-media-name": "Office", "x-media-width": "1080", "x-media-height": "1350" })).status, 200);
  const { media } = await (await app.request("/media")).json();
  assert.equal(media.length, 1);
  assert.equal(media[0].name, "Office");
  assert.equal(media[0].width, 1080);
  assert.equal(media[0].mimeType, "image/png");

  const served = await app.request(`/media/${encodeURIComponent(KEY)}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal((await served.arrayBuffer()).byteLength, 68, "the decoded PNG, byte for byte");

  const withImage = JSON.stringify({ slides: [{ title: "Photo", background: KEY }] });
  const { carousel } = await (await app.request(jsonRequest("/carousels", { config: withImage }))).json();
  const remove = () => app.request(new Request(`http://localhost/media/${encodeURIComponent(KEY)}`, { method: "DELETE" }));
  assert.equal((await remove()).status, 409, "in use by a deck");
  await app.request(new Request(`http://localhost/carousels/${carousel.id}`, { method: "DELETE" }));
  assert.equal((await remove()).status, 200);
  assert.equal((await remove()).status, 404);
  assert.equal((await app.request(`/media/${encodeURIComponent(KEY)}`)).status, 200, "removal retains bytes for concurrent saves");
  assert.deepEqual((await (await app.request("/media")).json()).media, []);
  await put({ "x-media-library": "1", "x-media-name": "Restored" });
  assert.equal((await (await app.request("/media")).json()).media[0].name, "Restored");

  const bad = await app.request(new Request(`http://localhost/media/${encodeURIComponent(KEY)}`, { method: "PUT", body: "data:image/svg+xml;base64,PHN2Zz4=" }));
  assert.equal(bad.status, 400);
  assert.equal((await app.request("/media/not-a-key")).status, 400);
});

test("a configured secret closes the API until the cookie is presented", async () => {
  const { app } = api({ secret: "hunter2-hunter2" });
  assert.equal((await app.request("/carousels")).status, 401);
  assert.deepEqual(await (await app.request("/session")).json(), { gated: true, authorised: false });

  const wrong = await app.request(jsonRequest("/session", { password: "nope" }));
  assert.equal(wrong.status, 401);
  const right = await app.request(jsonRequest("/session", { password: "hunter2-hunter2" }));
  assert.equal(right.status, 200);
  const cookie = right.headers.get("set-cookie");
  assert.match(cookie, /^vertica_session=/);
  assert.doesNotMatch(cookie, /Secure/, "plain http keeps the cookie usable in development");

  const signedIn = await app.request(new Request("http://localhost/carousels", { headers: { cookie: cookie.split(";")[0] } }));
  assert.equal(signedIn.status, 200);
  const forged = await createSessionCookie("another-secret", false);
  const rejected = await app.request(new Request("http://localhost/carousels", { headers: { cookie: forged.split(";")[0] } }));
  assert.equal(rejected.status, 401);
});

test("with no secret set the API is open, which is what local development wants", async () => {
  const { app } = api();
  assert.deepEqual(await (await app.request("/session")).json(), { gated: false, authorised: true });
  assert.equal((await app.request("/carousels")).status, 200);
});

test("carousel routes reject path traversal without touching files outside the bucket", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "vertica-traversal-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "data");
  mkdirSync(root);
  const sentinel = join(directory, "sentinel.json");
  writeFileSync(sentinel, "keep this file");
  const app = createApi({ bucket: new LocalBucket(root) });
  for (const id of ["..%2F..%2Fsentinel", "%2Ftmp%2Fsentinel", "bad%5Cid", "bad%00id", "a".repeat(201)]) {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const path = `/carousels/${id}`;
      const request = method === "PUT"
        ? jsonRequest(path, { version: 1, config: deck() }, method)
        : new Request(`http://localhost${path}`, { method });
      assert.equal((await app.request(request)).status, 400, `${method} ${id}`);
      assert.equal(readFileSync(sentinel, "utf8"), "keep this file");
    }
  }
});

test("simultaneous local edits accept one writer and reject the stale writer", async () => {
  const { app } = api();
  const { carousel } = await (await app.request(jsonRequest("/carousels", { config: deck() }))).json();
  const results = await Promise.all(["Editor A", "Editor B"].map(async (title) => {
    const response = await app.request(jsonRequest(`/carousels/${carousel.id}`, { version: carousel.version, config: deck(title) }, "PUT"));
    return { status: response.status, body: await response.json() };
  }));
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
  const winner = results.find(({ status }) => status === 200).body.carousel;
  const fetched = (await (await app.request(`/carousels/${carousel.id}`)).json()).carousel;
  assert.equal(fetched.config, winner.config);
  assert.equal(fetched.version, winner.version);
});


test("lists every deck beyond the former 200-deck limit with stable ordering", async () => {
  const { app, bucket } = api();
  // Identical timestamps exercise the ID tie-breaker too.
  bucket.list = async () => Array.from({ length: 205 }, (_, i) => ({
    key: `carousels/deck-${String(204 - i).padStart(3, "0")}.json`,
    meta: { generation: 1, updated: "2026-09-10T12:00:00Z", custom: {} },
  }));
  const { carousels } = await (await app.request("/carousels")).json();
  assert.equal(carousels.length, 205);
  assert.equal(carousels[0].id, "deck-000");
  assert.equal(carousels.at(-1).id, "deck-204");
});

test("an image referenced by a save after the removal check remains available", async () => {
  const { app, bucket } = api();
  await app.request(new Request(`http://localhost/media/${KEY}`, {
    method: "PUT", body: PIXEL, headers: { "x-media-library": "1" },
  }));
  const list = bucket.list.bind(bucket);
  bucket.list = async (prefix) => {
    const beforeSave = await list(prefix);
    if (prefix === "carousels/") {
      await app.request(jsonRequest("/carousels", { id: "concurrent", config: JSON.stringify({ slides: [{ title: "Saved while removing", background: KEY }] }) }));
    }
    return beforeSave;
  };
  assert.equal((await app.request(`/media/${KEY}`, { method: "DELETE" })).status, 200);
  assert.equal((await app.request(`/media/${KEY}`)).status, 200);
  assert.equal((await app.request("/carousels/concurrent")).status, 200);
  assert.deepEqual((await (await app.request("/media")).json()).media, []);
});

test("image removal cannot overwrite a concurrent library reupload", async () => {
  const { app, bucket } = api();
  const upload = (name, width) => app.request(new Request(`http://localhost/media/${KEY}`, {
    method: "PUT", body: PIXEL,
    headers: { "x-media-library": "1", "x-media-name": name, "x-media-width": String(width) },
  }));
  assert.equal((await upload("Old name", 1)).status, 200);
  const list = bucket.list.bind(bucket);
  // The removal has read the old object before checking deck references.
  bucket.list = async (prefix) => {
    const rows = await list(prefix);
    if (prefix === "carousels/") assert.equal((await upload("New name", 2)).status, 200);
    return rows;
  };
  const response = await app.request(`/media/${KEY}`, { method: "DELETE" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Reload the library/);
  const { media } = await (await app.request("/media")).json();
  assert.equal(media.length, 1);
  assert.equal(media[0].name, "New name");
  assert.equal(media[0].width, 2);
  assert.equal((await app.request(`/media/${KEY}`)).status, 200);
});
