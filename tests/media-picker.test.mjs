import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

register("./component-loader.mjs", import.meta.url);
const { default: MediaPicker } = await import("../app/media-picker.tsx");

async function picker(t, { failPersistence = false, failSelection = false } = {}) {
  const dom = new JSDOM('<!doctype html><button id="opener">Choose image</button><div id="root"></div>', { url: "http://localhost" });
  const { window } = dom;
  const restoreGlobals = [];
  for (const [key, value] of Object.entries({ window, document: window.document, HTMLElement: window.HTMLElement, FileReader: window.FileReader, IS_REACT_ACT_ENVIRONMENT: true, createImageBitmap: async () => ({ width: 640, height: 480, close() {} }) })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restoreGlobals.push(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  // Browser-native focus containment is checked in Chrome. jsdom supplies the
  // component DOM; decoding and canvas encoding are browser API boundaries here.
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  t.mock.method(window.HTMLCanvasElement.prototype, "getContext", () => ({ drawImage() {} }));
  t.mock.method(window.HTMLCanvasElement.prototype, "toBlob", function (callback) { callback(new window.Blob(["encoded image"], { type: "image/webp" })); });
  const uploads = [];
  const selected = [];
  let closed = false;
  let persistFailure = failPersistence;
  let selectFailure = failSelection;
  let persistenceGate = null;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (init?.method === "PUT") {
      uploads.push({ url, init });
      if (persistenceGate) await persistenceGate;
      return Response.json(persistFailure ? { error: "Upload failed. Try again." } : { ok: true }, { status: persistFailure ? 503 : 200 });
    }
    assert.equal(url, "/api/media");
    return Response.json({ media: [], nextCursor: null });
  });
  const root = createRoot(window.document.getElementById("root"));
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); restoreGlobals.forEach((restore) => restore()); });
  const onChoose = async (asset) => {
    if (selectFailure) throw new Error("Selection failed. Try again.");
    selected.push(asset);
  };
  await act(async () => root.render(createElement(MediaPicker, { onChoose, onClose: () => { closed = true; } })));
  const buttons = () => [...window.document.querySelectorAll("button")];
  const uploadButton = () => buttons().find((button) => button.textContent.includes("Upload image"));
  const input = window.document.querySelector('input[type="file"]');
  const pick = async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new window.File(["source image"], "Office.png", { type: "image/png" })] });
    await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
  };
  const waitFor = async (predicate) => {
    for (let tries = 0; tries < 100; tries++) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
      if (predicate()) return;
    }
    assert.fail("Timed out waiting for the picker state");
  };
  return { window, uploads, selected, pick, waitFor, uploadButton, closed: () => closed,
    retryPersistence: () => { persistFailure = false; }, retrySelection: () => { selectFailure = false; },
    holdPersistence: (gate) => { persistenceGate = gate; } };
}

test("picker uploads, persists metadata, selects the image, and closes", async (t) => {
  const p = await picker(t);
  let release;
  p.holdPersistence(new Promise((resolve) => { release = resolve; }));
  await p.pick();
  await p.waitFor(() => p.uploads.length === 1);
  assert.equal(p.uploadButton().disabled, true);
  assert.equal(p.uploadButton().getAttribute("aria-busy"), "true");
  assert.equal(p.selected.length, 0, "selection waits for durable upload");
  release();
  await p.waitFor(p.closed);
  assert.equal(p.selected.length, 1);
  assert.match(p.selected[0].key, /^img:/);
  assert.equal(p.selected[0].name, "Office");
  assert.equal(p.selected[0].width, 640);
  assert.equal(p.selected[0].height, 480);
  assert.equal(p.uploads[0].init.headers["x-media-library"], "1");
  assert.equal(p.uploads[0].init.headers["x-media-width"], "640");
  assert.match(p.uploads[0].init.body, /^data:image\/webp;base64,/);
});

test("picker keeps the dialog open after persistence failure and can retry the same file", async (t) => {
  const p = await picker(t, { failPersistence: true });
  await p.pick();
  await p.waitFor(() => p.window.document.body.textContent.includes("Upload failed. Try again."));
  assert.equal(p.closed(), false);
  assert.equal(p.selected.length, 0);
  assert.equal(p.uploadButton().disabled, false);
  p.retryPersistence();
  await p.pick();
  await p.waitFor(p.closed);
  assert.equal(p.uploads.length, 2);
  assert.equal(p.selected.length, 1);
});

test("picker retains a successfully uploaded image when selection fails, then selects it without uploading again", async (t) => {
  const p = await picker(t, { failSelection: true });
  await p.pick();
  await p.waitFor(() => p.window.document.body.textContent.includes("Selection failed. Try again."));
  assert.equal(p.closed(), false);
  const useImage = p.window.document.querySelector('[aria-label="Use Office"]');
  assert.ok(useImage);
  assert.equal(useImage.disabled, false);
  p.retrySelection();
  await act(async () => useImage.click());
  await p.waitFor(p.closed);
  assert.equal(p.uploads.length, 1);
  assert.equal(p.selected.length, 1);
});
