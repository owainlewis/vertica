import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

register("./component-loader.mjs", import.meta.url);
const { normalizeSlideLayout } = await import("../app/carousel.ts");
const { Slide, ExportStage } = await import("../app/slide.tsx");

const config = {
  version: 1, title: "Engineering with AI", author: "aiengineer.co", mark: "AI Engineer", theme: "ai-engineer",
  slides: ["cover", "content", "note", "poster", "diagram", "photos", "closing"].map((layout, index) => ({
    id: String(index), layout, title: "Keep your *judgment*", body: "Review what you ship.",
  })),
};

for (const theme of ["editorial", "ai-engineer"]) {
  test(`${theme}: current and legacy layouts use the same content and scale in preview and export`, () => {
    const themed = { ...config, theme };
    const exported = new JSDOM(renderToStaticMarkup(createElement(ExportStage, { config: themed })));
    const nodes = [...exported.window.document.querySelectorAll("[data-export-slide='true']")];
    assert.equal(nodes.length, 7);
    config.slides.forEach((slide, index) => {
      const preview = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: themed, slide, index })));
      const node = preview.window.document.querySelector("article");
      assert.ok(node.classList.contains(`template-${theme}`));
      assert.ok(node.classList.contains(`layout-${normalizeSlideLayout(slide).layout}`));
      assert.equal(nodes[index].getAttribute("style"), node.getAttribute("style"));
      assert.equal(nodes[index].innerHTML, node.innerHTML);
      assert.equal(node.querySelector(".slide-mark").textContent, "AI Engineer");
      preview.window.close();
    });
    exported.window.close();
  });
}

test("a deck without a theme still renders an Editorial cover", () => {
  const legacy = { ...config, theme: undefined };
  const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: legacy, slide: legacy.slides[0], index: 0 })));
  const node = dom.window.document.querySelector("article");
  assert.ok(node.classList.contains("template-editorial"));
  assert.ok(node.classList.contains("tone-paper"));
  assert.ok(node.classList.contains("align-center"));
  const explicit = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: { ...legacy, theme: "editorial" }, slide: legacy.slides[0], index: 0 })));
  assert.equal(node.getAttribute("style"), explicit.window.document.querySelector("article").getAttribute("style"));
  explicit.window.close();
  dom.window.close();
});
