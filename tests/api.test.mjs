import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
  assert.equal((await app.request(`/media/${encodeURIComponent(KEY)}`)).status, 404);

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
