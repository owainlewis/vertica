import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

register("./component-loader.mjs", import.meta.url);
const { default: Dashboard } = await import("../app/dashboard.tsx");

test("the gallery pages every deck and searches beyond the visible page", async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  const { window } = dom;
  const restore = [];
  for (const [key, value] of Object.entries({ window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restore.push(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const rows = Array.from({ length: 205 }, (_, i) => ({
    id: String(i), title: `Deck ${String(i).padStart(3, "0")}`, author: "", slideCount: 1,
    coverTitle: "", cover: "{}", updatedAt: "2026-09-10T12:00:00Z",
  }));
  t.mock.method(globalThis, "fetch", async () => Response.json({ carousels: rows }));
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(window.document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); restore.forEach((fn) => fn()); });
  await act(async () => root.render(createElement(Dashboard, { onOpen() {}, onCreate() {}, reloadToken: 0 })));
  const cards = () => window.document.querySelectorAll(".gallery-card");
  assert.equal(cards().length, 24);
  const more = () => [...window.document.querySelectorAll("button")].find((button) => button.textContent.startsWith("Load more carousels"));
  const input = window.document.querySelector('[aria-label="Search carousels"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "Deck 204");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.equal(cards().length, 1);
  assert.ok(window.document.querySelector('[aria-label="Open Deck 204"]'));
  await act(async () => window.document.querySelector('[aria-label="Clear search"]').click());
  assert.equal(cards().length, 24);
  while (more()) await act(async () => more().click());
  assert.equal(cards().length, 205);
});
