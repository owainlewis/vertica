import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

register("./component-loader.mjs", import.meta.url);
const { Slide } = await import("../app/slide.tsx");

test("old saved settings render plain two-digit page numbers and no avatar in preview and export", () => {
  // Saved decks are loaded directly as JSON, so legacy fields can still reach
  // the renderer even though newly imported configs no longer contain them.
  const config = {
    version: 1, title: "Legacy deck", author: "aiengineer.co", mark: "AI Engineer",
    avatar: "data:image/png;base64,YQ==", numbering: "fraction",
    slides: Array.from({ length: 10 }, (_, index) => ({ id: String(index), layout: "content", title: "Headline", body: "Supporting copy." })),
  };
  for (const index of [0, 1, 9]) {
    for (const exportMode of [false, true]) {
      const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { slide: config.slides[index], config, index, exportMode })));
      try {
        assert.equal(dom.window.document.querySelector(".slide-counter").textContent, ["01", "02", "10"][[0, 1, 9].indexOf(index)]);
        assert.equal(dom.window.document.querySelectorAll("img").length, 0);
        assert.equal(dom.window.document.querySelector(".meta-author").textContent, "aiengineer.co");
      } finally { dom.window.close(); }
    }
  }
});
