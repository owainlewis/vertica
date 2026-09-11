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

test("Cinematic photo and video defaults differ while explicit positions and saved tones survive", () => {
  for (const [format, expected] of [["image", "top"], ["video", "middle"]]) {
    const themed = { ...config, theme: "cinematic", format };
    const source = { ...config.slides[0], label: "Rule 01", tone: "paper" };
    const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: themed, slide: source, index: 0 })));
    const node = dom.window.document.querySelector("article");
    assert.ok(node.classList.contains(`pos-${expected}`));
    assert.ok(node.classList.contains("tone-black"));
    assert.equal(node.querySelector(".slide-label").textContent, "Rule 01");
    assert.equal(source.tone, "paper");
    dom.window.close();
    const explicit = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: themed, slide: { ...source, position: "bottom", align: "center" }, index: 0 })));
    assert.ok(explicit.window.document.querySelector("article.pos-bottom.align-center"));
    explicit.window.close();
  }
});

test("Cinematic uses a fixed cover, heading and body scale across image and video carousels", () => {
  for (const format of ["image", "video"]) {
    for (const layout of ["cover", "content", "note", "closing"]) {
      const themed = { ...config, theme: "cinematic", format };
      const source = { ...config.slides[0], layout };
      const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: themed, slide: source, index: 0 })));
      const style = dom.window.document.querySelector("article").style;
      const phonePixels = (property) => parseFloat(style.getPropertyValue(property)) * 390 / 100;
      assert.ok(Math.abs(phonePixels("--title-size") - (layout === "cover" ? 32 : 22)) < 0.001);
      assert.ok(Math.abs(phonePixels("--reading-size") - 18) < 0.001);
      dom.window.close();
    }
  }
});

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


test("display titles keep their hierarchy while reading copy stays at 18px", () => {
  for (const theme of ["editorial", "ai-engineer"]) {
    for (const source of config.slides) {
      const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: { ...config, theme }, slide: source, index: 0 })));
      const slide = dom.window.document.querySelector("article");
      assert.ok(Math.abs(parseFloat(slide.style.getPropertyValue("--reading-size")) * 390 / 100 - 18) < 0.001);
      const title = parseFloat(slide.style.getPropertyValue("--title-size"));
      const layout = normalizeSlideLayout(source);
      if (layout.layout === "cover") assert.equal(title, theme === "editorial" ? 12.8 : 10.6);
      else if (layout.layout === "closing") assert.equal(title, 8);
      else if (layout.layout === "note" && !layout.visual) assert.equal(title, 6);
      else assert.ok(Math.abs(title * 390 / 100 - 18) < 0.001);
      assert.equal(slide.querySelector(".slide-rules"), null);
      dom.window.close();
    }
  }
});
