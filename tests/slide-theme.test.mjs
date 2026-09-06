import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

register("./component-loader.mjs", import.meta.url);
const { Slide, ExportStage } = await import("../app/slide.tsx");

const config = {
  version: 1, title: "Engineering with AI", author: "aiengineer.co", mark: "AI Engineer", theme: "ai-engineer",
  slides: ["cover", "content", "note", "poster", "diagram", "photos", "closing"].map((layout, index) => ({
    id: String(index), layout, title: "Keep your *judgment*", body: "Review what you ship.",
  })),
};

test("all seven layouts use the same theme, content and scale in preview and export", () => {
  const exported = new JSDOM(renderToStaticMarkup(createElement(ExportStage, { config })));
  const nodes = [...exported.window.document.querySelectorAll("[data-export-slide='true']")];
  assert.equal(nodes.length, 7);
  config.slides.forEach((slide, index) => {
    const preview = new JSDOM(renderToStaticMarkup(createElement(Slide, { config, slide, index })));
    const node = preview.window.document.querySelector("article");
    assert.ok(node.classList.contains("template-ai-engineer"));
    assert.ok(node.classList.contains(`layout-${slide.layout}`));
    assert.equal(nodes[index].getAttribute("style"), node.getAttribute("style"));
    assert.equal(nodes[index].innerHTML, node.innerHTML);
    assert.equal(node.querySelector(".slide-mark").textContent, "AI Engineer");
    preview.window.close();
  });
  exported.window.close();
});

test("a deck without a theme still renders the original Editorial cover", () => {
  const legacy = { ...config, theme: undefined };
  const dom = new JSDOM(renderToStaticMarkup(createElement(Slide, { config: legacy, slide: legacy.slides[0], index: 0 })));
  const node = dom.window.document.querySelector("article");
  assert.ok(node.classList.contains("template-editorial"));
  assert.ok(node.classList.contains("tone-paper"));
  assert.ok(node.classList.contains("align-center"));
  assert.equal(node.style.getPropertyValue("--title-size"), "12.4cqw");
  dom.window.close();
});
