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


test("header and footer visibility is independent across layouts, previews, and exports", () => {
  for (const layout of ["cover", "content", "note", "poster", "diagram", "photos", "closing"]) {
    for (const exportMode of [false, true]) {
      for (const [showHeader, showFooter] of [[false, false], [false, true], [true, false], [undefined, undefined]]) {
        const slide = { id: "one", layout, title: "Main text", body: "Supporting copy", showHeader, showFooter };
        const config = { version: 1, title: "Visibility", author: "Author", mark: "Series", slides: [slide, { ...slide, id: "two" }] };
        const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { slide, config, index: 0, exportMode })));
        try {
          const document = dom.window.document;
          const context = `${layout}, export=${exportMode}, header=${showHeader}, footer=${showFooter}`;
          for (const selector of [".slide-head", ".slide-mark", ".slide-counter"]) {
            assert.equal(Boolean(document.querySelector(selector)), showHeader !== false, `${selector}: ${context}`);
          }
          for (const selector of [".slide-meta", ".meta-author", ".slide-arrow"]) {
            assert.equal(Boolean(document.querySelector(selector)), showFooter !== false, `${selector}: ${context}`);
          }
          assert.equal(document.querySelector("h2").textContent, "Main text", context);
          if (layout === "note" && showHeader === false && showFooter === false) {
            assert.equal(document.querySelector("article").textContent, "Main text", "a note can contain only its main text");
          }
        } finally { dom.window.close(); }
      }
    }
  }
});

test("showing the footer still respects the deck arrow setting and last slide", () => {
  const slide = { id: "one", layout: "note", title: "Main text", body: "", showFooter: true };
  for (const [arrow, index] of [[false, 0], [true, 1]]) {
    const config = { version: 1, title: "Arrow", author: "Author", arrow, slides: [slide, { ...slide, id: "two" }] };
    const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { slide, config, index })));
    try {
      assert.equal(dom.window.document.querySelector(".meta-author").textContent, "Author");
      assert.equal(dom.window.document.querySelector(".slide-arrow"), null);
    } finally { dom.window.close(); }
  }
});
