import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { isStudioLocation } from "../app/routes.ts";

register("./component-loader.mjs", import.meta.url);
const { default: Root } = await import("../app/root.tsx");

test("public and existing studio links have distinct routes", () => {
  for (const search of ["", "?ref=saaspo.com", "?view=unknown", "?id="]) assert.equal(isStudioLocation({ search }), false);
  for (const search of ["?id=deck-123", "?view=media", "?view=carousels", "?ref=home&view=carousels"]) assert.equal(isStudioLocation({ search }), true);
});

test("homepage works without API access and changes the real slide themes", async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  const { window } = dom;
  const restorers = [];
  for (const [key, value] of Object.entries({ window, document: window.document, HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restorers.push(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Public homepage must not call the API"); });
  const root = createRoot(window.document.getElementById("root"));
  t.after(async () => { await act(() => root.unmount()); window.close(); restorers.forEach((restore) => restore()); });
  await act(() => root.render(createElement(Root)));
  assert.equal(window.document.querySelector("h1").textContent, "Build beautiful carousels for social media.");
  assert.match(window.document.body.textContent, /Not open for sign-ups yet/);
  assert.equal(window.document.querySelectorAll("form").length, 0);
  assert.equal(window.document.querySelector('a[href="/?view=carousels"]').textContent, "Studio access ");
  assert.equal(window.document.querySelectorAll(".carousel-slide.tone-paper").length, 3);
  await act(() => window.document.querySelector('[aria-label="Ink theme"]').click());
  assert.equal(window.document.querySelectorAll(".carousel-slide.tone-black").length, 3);
  await act(() => window.document.querySelector('[aria-label="Sage theme"]').click());
  assert.equal(window.document.querySelectorAll(".carousel-slide.tone-sage").length, 3);
  assert.equal(fetch.mock.callCount(), 0);
});
