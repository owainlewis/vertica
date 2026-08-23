import assert from "node:assert/strict";
import test from "node:test";
import { handleApi } from "../worker/api.ts";
import { createSessionCookie, isAuthorised } from "../worker/auth.ts";

/** Enough of D1 to exercise the handlers without a real database. */
function fakeDb() {
  const rows = new Map();
  const statement = (query) => ({
    _values: [],
    bind(...values) { this._values = values; return this; },
    async all() {
      if (/FROM carousels/.test(query)) {
        return { results: [...rows.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)) };
      }
      return { results: [] };
    },
    async first() {
      return rows.get(this._values[0]) ?? null;
    },
    async run() {
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

  return { rows, prepare: statement, batch: async () => {}, exec: async () => {} };
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

  const created = await handleApi(post({ config }), env);
  assert.equal(created.status, 201);
  const { carousel } = await created.json();
  assert.equal(carousel.title, "AI code review");
  assert.equal(carousel.template, "dark");
  assert.equal(JSON.parse(carousel.cover).scaleVersion, 2);
  assert.equal(carousel.slideCount, 2);
  assert.equal(carousel.coverTitle, "Four AI reviewers");

  const listed = await handleApi(new Request("http://localhost/api/carousels"), env);
  const { carousels } = await listed.json();
  assert.equal(carousels.length, 1);
  assert.equal(carousels[0].id, carousel.id);
  // The list view must not ship every slide of every deck to the dashboard.
  assert.equal(carousels[0].config, undefined);
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
