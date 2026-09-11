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

for (const theme of ["editorial", "ai-engineer", "cinematic"]) {
  test(`${theme}: current and legacy layouts use the same content and scale in preview and export`, () => {
    const themed = { ...config, theme };
    const exported = new JSDOM(renderToStaticMarkup(createElement(ExportStage, { config: themed })));
    const nodes = [...exported.window.document.querySelectorAll("[data-export-slide='true']")];
    assert.equal(nodes.length, 7);
    config.slides.forEach((slide, index) => {
      const preview = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: themed, slide, index })));
      const node = preview.window.document.querySelector("article");
      assert.ok(node.classList.contains("template-cinematic"));
      assert.ok(node.classList.contains(`layout-${normalizeSlideLayout(slide).layout}`));
      assert.equal(nodes[index].getAttribute("style"), node.getAttribute("style"));
      assert.equal(nodes[index].innerHTML, node.innerHTML);
      assert.equal(node.querySelector(".slide-mark").textContent, "AI Engineer");
      preview.window.close();
    });
    exported.window.close();
  });
}

test("Cinematic photo and video defaults differ while explicit positions and saved tones survive", () => {
  for (const [format, expected] of [["image", "top"], ["video", "middle"]]) {
    const themed = { ...config, theme: "cinematic", format };
    const source = { ...config.slides[0], label: "Rule 01", tone: "paper" };
    const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: themed, slide: source, index: 0 })));
    const node = dom.window.document.querySelector("article");
    assert.ok(node.classList.contains(`pos-${expected}`));
    assert.ok(node.classList.contains("tone-paper"));
    assert.equal(node.querySelector(".slide-label").textContent, "Rule 01");
    assert.equal(source.tone, "paper");
    dom.window.close();
    const explicit = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: themed, slide: { ...source, position: "bottom", align: "center" }, index: 0 })));
    assert.ok(explicit.window.document.querySelector("article.pos-bottom.align-center"));
    explicit.window.close();
  }
});

test("Each typeface keeps its golden-ratio size across themes, formats and layouts", () => {
  for (const theme of ["editorial", "ai-engineer", "cinematic"]) for (const format of ["image", "video"]) {
    for (const typeface of ["sans", "serif"]) for (const layout of ["cover", "content", "note", "closing"]) {
      const themed = { ...config, theme, format };
      const source = { ...config.slides[0], layout, typeface };
      const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: themed, slide: source, index: 0 })));
      const style = dom.window.document.querySelector("article").style;
      const phonePixels = (property) => parseFloat(style.getPropertyValue(property)) * 390 / 100;
      assert.ok(Math.abs(phonePixels("--title-size") - (typeface === "serif" ? 42 : 26)) < 0.001);
      assert.ok(Math.abs(phonePixels("--reading-size") - 16) < 0.001);
      dom.window.close();
    }
  }
});

test("a deck without a theme uses Cinematic with legacy serif defaults", () => {
  const legacy = { ...config, theme: undefined };
  const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: legacy, slide: legacy.slides[0], index: 0 })));
  const node = dom.window.document.querySelector("article");
  assert.ok(node.classList.contains("type-serif"));
  assert.ok(node.classList.contains("tone-paper"));
  assert.ok(node.classList.contains("align-center"));
  const explicit = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: { ...legacy, theme: "editorial" }, slide: legacy.slides[0], index: 0 })));
  assert.equal(node.getAttribute("style"), explicit.window.document.querySelector("article").getAttribute("style"));
  explicit.window.close();
  dom.window.close();
});


test("Legacy layouts inherit the new scale without changing saved typography defaults", () => {
  for (const theme of ["editorial", "ai-engineer"]) {
    for (const source of config.slides) {
      const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: { ...config, theme }, slide: source, index: 0 })));
      const slide = dom.window.document.querySelector("article");
      assert.ok(Math.abs(parseFloat(slide.style.getPropertyValue("--reading-size")) * 390 / 100 - 16) < 0.001);
      const title = parseFloat(slide.style.getPropertyValue("--title-size"));
      assert.ok(Math.abs(title * 390 / 100 - (theme === "editorial" ? 42 : 26)) < 0.001);
      assert.equal(slide.querySelector(".slide-rules"), null);
      dom.window.close();
    }
  }
});


test("a body-only slide has no empty headline consuming title spacing", () => {
  const source = {...config.slides[1], title: "   ", label: "Step 1", body: "Choose one task.\n\nTry it on real notes."};
  const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, {config, slide: source, index: 1})));
  assert.equal(dom.window.document.querySelector("h2"), null);
  assert.equal(dom.window.document.querySelector(".slide-label + p").textContent, "Choose one task.");
  assert.equal(dom.window.document.querySelectorAll(".slide-content p").length, 2);
  dom.window.close();
});
