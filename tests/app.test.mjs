import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

register("./component-loader.mjs", import.meta.url);
const { default: App } = await import("../app/app.tsx");

function record(id) {
  const config = { version: 1, title: `Deck ${id}`, author: "Reviewer", slides: [{ id: "one", layout: "cover", title: `Deck ${id}`, body: "" }] };
  return { id, title: config.title, author: config.author, slideCount: 1, coverTitle: config.title, cover: JSON.stringify({ slide: config.slides[0] }), config: JSON.stringify(config), version: 1, createdAt: "2026-09-07T12:00:00Z", updatedAt: "2026-09-07T12:00:00Z" };
}

async function app(t, path = "/?id=old") {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: `http://localhost${path}` });
  const { window } = dom;
  const restore = [];
  for (const [key, value] of Object.entries({ window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restore.push(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  window.HTMLElement.prototype.scrollTo = () => {};
  const pending = new Map();
  const writes = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/session") return Response.json({ gated: false, authorised: true });
    if (url === "/api/media") return Response.json({ media: [], nextCursor: null });
    if (init?.method === "POST") {
      const payload = JSON.parse(init.body);
      writes.push(JSON.parse(payload.config));
      return Response.json({ carousel: { ...record("saved"), config: payload.config } });
    }
    if (url === "/api/carousels") return Response.json({ carousels: [record("old"), record("newer")] });
    return new Promise((resolve) => pending.set(url, resolve));
  });
  const root = createRoot(window.document.getElementById("root"));
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); restore.forEach((fn) => fn()); });
  await act(() => root.render(createElement(App)));
  return {
    document: window.document, window, writes, pending,
    async click(label) {
      const button = [...window.document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label);
      assert.ok(button, `Button ${label} exists`);
      await act(() => button.click());
    },
    async finish(id, status = 200) {
      const resolve = pending.get(`/api/carousels/${id}`);
      assert.ok(resolve, `Request for ${id} exists`);
      await act(() => resolve(Response.json(status === 200 ? { carousel: record(id) } : { error: "Old load failed" }, { status })));
    },
  };
}

test("a delayed deep link cannot replace a new draft or cancel its autosave", async (t) => {
  const view = await app(t);
  await view.click("New carousel");
  await view.click("Add slide");
  assert.equal(view.document.querySelectorAll(".slide-thumb").length, 2);
  await view.finish("old");
  assert.equal(view.document.querySelectorAll(".slide-thumb").length, 2);
  assert.equal(view.document.querySelector('[aria-label="Carousel title"]').value, "Untitled carousel");
  await act(() => new Promise((resolve) => setTimeout(resolve, 1250)));
  assert.equal(view.writes.length, 1);
  assert.equal(view.writes[0].slides.length, 2);
  assert.equal(view.window.location.search, "?id=saved");
});

test("navigating to a library invalidates a pending deck response and error", async (t) => {
  for (const status of [200, 503]) {
    await t.test(String(status), async (t) => {
      const view = await app(t);
      await view.click("Media");
      await view.finish("old", status);
      assert.equal(view.document.querySelector("h1").textContent, "Media library");
      assert.equal(view.document.querySelector(".toast.error"), null);
      assert.equal(view.window.location.search, "?view=media");
    });
  }
});

test("Back to the gallery invalidates a pending deep link", async (t) => {
  const view = await app(t);
  await act(() => {
    view.window.history.replaceState({}, "", "/");
    view.window.dispatchEvent(new view.window.PopStateEvent("popstate"));
  });
  await view.finish("old");
  assert.equal(view.document.querySelector("h1").textContent, "Your carousels");
  assert.equal(view.window.location.search, "");
});

test("only the latest selected carousel can update the editor and history", async (t) => {
  const view = await app(t, "/");
  await view.click("Open Deck old");
  await view.click("Open Deck newer");
  await view.finish("newer");
  await view.finish("old");
  assert.equal(view.document.querySelector('[aria-label="Carousel title"]').value, "Deck newer");
  assert.equal(view.window.location.search, "?id=newer");
});
