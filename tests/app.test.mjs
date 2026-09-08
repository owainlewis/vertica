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

async function app(t, path = "/?id=old", rows = [record("old"), record("newer")]) {
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
    if (init?.method === "POST" || init?.method === "PUT") {
      const payload = JSON.parse(init.body);
      writes.push(JSON.parse(payload.config));
      return Response.json({ carousel: { ...record("saved"), config: payload.config } });
    }
    if (url === "/api/carousels") return Response.json({ carousels: rows });
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
    async finish(id, status = 200, config) {
      const resolve = pending.get(`/api/carousels/${id}`);
      assert.ok(resolve, `Request for ${id} exists`);
      await act(() => resolve(Response.json(status === 200 ? { carousel: { ...record(id), ...(config ? { config: JSON.stringify(config) } : {}) } } : { error: "Old load failed" }, { status })));
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


test("visibility edits update the selected slide, support undo, and save with duplicates", async (t) => {
  const view = await app(t, "/");
  await view.click("New carousel");
  await view.click("Add slide");
  await view.click("Layout");
  const checkbox = (label) => [...view.document.querySelectorAll("label.check-row")].find((node) => node.textContent.trim() === label).querySelector("input");
  await act(() => checkbox("Show header").click());
  assert.equal(view.document.querySelector(".preview-frame .slide-head"), null);
  assert.ok(view.document.querySelector(".preview-frame .slide-meta"));
  assert.ok(view.document.querySelector(".slide-thumb .slide-head"), "the first slide keeps its header");
  await view.click("Undo");
  assert.equal(checkbox("Show header").checked, true);
  assert.ok(view.document.querySelector(".preview-frame .slide-head"));
  await view.click("Redo");
  assert.equal(checkbox("Show header").checked, false);
  await act(() => checkbox("Show footer").click());
  assert.equal(view.document.querySelector(".preview-frame .slide-meta"), null);
  await view.click("Duplicate");
  assert.equal(checkbox("Show header").checked, false);
  assert.equal(checkbox("Show footer").checked, false);
  await view.click("Carousels");
  const saved = view.writes.at(-1);
  assert.ok(saved, "leaving the editor flushes the visibility edits");
  assert.deepEqual(saved.slides.map(({ showHeader, showFooter }) => [showHeader !== false, showFooter !== false]), [[true, true], [false, false], [false, false]]);
});


test("the editor has four layouts and preserves a legacy diagram when switching layouts", async (t) => {
  const svg = '<svg viewBox="0 0 800 500"><text x="20" y="50">A useful example</text></svg>';
  const view = await app(t);
  await view.finish("old", 200, { version: 1, title: "Old deck", author: "Author", slides: [{ id: "one", layout: "diagram", title: "A flow", body: "Hidden draft", diagram: svg }] });
  await view.click("Layout");
  const type = view.document.querySelector("#slide-layout");
  assert.deepEqual([...type.options].map((option) => option.text), ["Cover", "Body 1", "Body 2", "CTA"]);
  assert.equal(type.value, "note");
  async function select(node, value) {
    await act(() => { node.value = value; node.dispatchEvent(new view.window.Event("change", { bubbles: true })); });
  }
  await view.click("Content");
  assert.equal(view.document.querySelector("#slide-visual").value, "diagram");
  assert.equal(view.document.querySelector("#diagram").value, svg);
  assert.equal(view.document.querySelector(".preview-frame svg text").textContent, "A useful example");
  assert.equal(view.document.querySelector(".preview-frame .slide-content p"), null);
  await select(view.document.querySelector("#slide-visual"), "");
  assert.equal(view.document.querySelector(".preview-frame .slide-diagram"), null);
  await select(view.document.querySelector("#slide-visual"), "diagram");
  assert.equal(view.document.querySelector(".preview-frame svg text").textContent, "A useful example");
  await view.click("Layout");
  await select(view.document.querySelector("#slide-layout"), "cover");
  assert.equal(view.document.querySelector(".preview-frame .slide-diagram"), null);
  await select(view.document.querySelector("#slide-layout"), "note");
  assert.equal(view.document.querySelector(".preview-frame svg text").textContent, "A useful example");
  await view.click("Carousels");
  const saved = view.writes.at(-1).slides[0];
  assert.equal(saved.layout, "note");
  assert.equal(saved.visual, "diagram");
  assert.equal(saved.diagram, svg);
  assert.equal(saved.body, "Hidden draft");
});


test("gallery previews keep the visuals from legacy first-slide layouts", async (t) => {
  const layouts = ["diagram", "photos", "grid", "strip", "figure"];
  const rows = layouts.map((layout) => ({ ...record(layout), cover: JSON.stringify({ slide: {
    id: "first", layout, title: "A useful example", body: "Hidden draft",
    images: ["data:image/png;base64,YQ=="],
    diagram: '<svg viewBox="0 0 800 500"><text x="20" y="50">Visible diagram</text></svg>',
  } }) }));
  const view = await app(t, "/", rows);
  for (const layout of layouts) {
    const card = view.document.querySelector(`[aria-label="Open Deck ${layout}"]`);
    assert.ok(card.querySelector(".layout-note"), `${layout} uses Body 2`);
    assert.equal(card.querySelector(".slide-content p"), null, `${layout} keeps hidden copy hidden`);
    if (layout === "diagram") assert.equal(card.querySelector(".slide-diagram svg text")?.textContent, "Visible diagram");
    else assert.equal(card.querySelector(".slide-pictures img")?.getAttribute("src"), "data:image/png;base64,YQ==");
  }
});


test("deck-wide footer edits recheck overflow without changing the selected slide", async (t) => {
  const view = await app(t);
  // JSDOM has no layout. Model copy near a footer whose height changes with its arrow.
  t.mock.method(view.window.HTMLElement.prototype, "getBoundingClientRect", function () {
    const rect = (top, height) => new view.window.DOMRect(0, top, 400, height);
    if (this.matches("article")) return rect(0, 500);
    if (this.matches(".slide-head")) return rect(20, 20);
    if (this.matches(".slide-meta")) return rect(this.querySelector(".slide-arrow") ? 450 : 470, 20);
    if (this.matches("h2")) return rect(100, 40);
    if (this.matches(".slide-content p")) return rect(430, 30);
    return rect(0, 0);
  });
  const slide = { id: "one", layout: "content", title: "A useful point", body: "Copy near the footer." };
  await view.finish("old", 200, { version: 1, title: "Boundary", author: "Author", mark: "Series", slides: [slide, { ...slide, id: "two" }] });
  const measure = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  await measure();
  assert.ok(view.document.querySelector(".slide-overflow-warning"), "overlap is reported");
  await view.click("Design");
  const arrow = [...view.document.querySelectorAll("label.check-row")].find((node) => node.textContent.includes("Swipe arrow")).querySelector("input");
  await act(() => arrow.click());
  await measure();
  assert.equal(Boolean(view.document.querySelector(".slide-overflow-warning")), false, "the warning clears after the footer changes");
  await act(() => arrow.click());
  await measure();
  assert.ok(view.document.querySelector(".slide-overflow-warning"), "the warning returns when the footer overlaps again");
});
