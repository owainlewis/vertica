import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

register("./component-loader.mjs", import.meta.url);
const { drawnSvg } = await import("../app/drawn-diagram.ts");
const { parseCarouselConfig, sanitizeSvg, slidePosition, slideVisual } = await import("../app/carousel.ts");
const { Slide } = await import("../app/slide.tsx");

const DIAGRAM = '<svg viewBox="0 0 800 500" fill="none" stroke="currentColor" stroke-width="2">'
  + '<rect x="20" y="200" width="170" height="100" rx="8"/>'
  + '<rect x="315" y="180" width="200" height="140" rx="8" class="crosshatch"/>'
  + '<text x="415" y="262" text-anchor="middle" fill="currentColor" stroke="none" font-size="40">hook</text>'
  + '<polygon points="292,240 312,250 292,260" fill="currentColor"/>'
  + '<circle cx="600" cy="100" r="30" fill="#ddd"/>'
  + "</svg>";

function parse(svg) {
  const dom = new JSDOM(`<body>${svg}</body>`);
  return { document: dom.window.document, close: () => dom.window.close() };
}

test("hand drawing adds pencil, ink, construction and shadow layers to stroked shapes", () => {
  const { document, close } = parse(drawnSvg(sanitizeSvg(DIAGRAM), "one"));
  try {
    const svg = document.querySelector("svg");
    assert.ok(svg.classList.contains("drawn-diagram"));
    assert.equal(svg.querySelectorAll("defs filter").length, 5);
    // Two boxes, each with its own underdrawing and second ink pass.
    assert.equal(svg.querySelectorAll("rect.drawn-pencil").length, 2);
    assert.equal(svg.querySelectorAll("rect.drawn-ink").length, 2);
    assert.equal(svg.querySelectorAll(".drawn-construction").length, 2);
    assert.equal(svg.querySelectorAll(".drawn-shadow").length, 2);
    // The original strokes stay and are inked through the wobble filter.
    const boxes = [...svg.querySelectorAll("rect:not([class^=drawn])")].filter((box) => !box.closest("defs"));
    assert.equal(boxes.length, 2);
    assert.ok(boxes.every((box) => /^url\(#drawn-one-[\w-]+-ink\)$/.test(box.getAttribute("filter"))));
  } finally { close(); }
});

test("tinted and classed fills are hatched, solid ink fills stay solid, and labels stay clear", () => {
  const { document, close } = parse(drawnSvg(sanitizeSvg(DIAGRAM), "one"));
  try {
    const hatches = [...document.querySelectorAll(".drawn-hatch")];
    // The crosshatched box has two layers; the tinted circle has one.
    assert.equal(hatches.filter((layer) => layer.tagName === "rect").length, 2);
    assert.equal(hatches.filter((layer) => layer.tagName === "circle").length, 1);
    assert.equal(document.querySelector("circle:not([class])").getAttribute("fill"), "none");
    // An arrowhead is drawn in solid ink, never hatched.
    const head = document.querySelector("polygon:not([class])");
    assert.equal(head.getAttribute("fill"), "currentColor");
    assert.equal(document.querySelectorAll("polygon.drawn-hatch").length, 0);
    // The label inside the crosshatched box has a hole cut in the hatching.
    const mask = document.querySelector("mask");
    assert.ok(mask);
    assert.equal(mask.querySelectorAll("rect[fill=black]").length, 1);
    assert.ok(hatches.every((layer) => layer.getAttribute("mask") === `url(#${mask.id})`));
  } finally { close(); }
});

test("drawing is deterministic, scoped per mount, and keeps sanitised content inert", () => {
  const clean = sanitizeSvg(DIAGRAM);
  assert.equal(drawnSvg(clean, "a"), drawnSvg(clean, "a"));
  const ids = (svg) => [...svg.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const first = ids(drawnSvg(clean, "a"));
  const second = ids(drawnSvg(clean, "b"));
  assert.ok(first.length > 0);
  assert.equal(first.filter((id) => second.includes(id)).length, 0);

  const hostile = sanitizeSvg('<svg viewBox="0 0 800 500"><rect width="10" height="10" stroke="currentColor" onload="alert(1)"/><script>alert(1)</script><text x="1" y="40">&lt;b&gt; &amp; "q"</text></svg>');
  const drawn = drawnSvg(hostile, "x");
  assert.doesNotMatch(drawn, /onload|<script|<b>/i);
  assert.match(drawn, /&lt;b&gt; &amp; "q"/);
  assert.equal(drawnSvg("", "x"), "");
});

test("diagram style survives a JSON round trip and covers can carry a diagram", () => {
  const config = parseCarouselConfig(JSON.stringify({
    version: 1, title: "Drawn", author: "Author",
    slides: [
      { layout: "cover", visual: "diagram", diagramStyle: "drawn", title: "Cover", body: "Sub", diagram: DIAGRAM },
      { layout: "note", visual: "diagram", diagramStyle: "sketchy", title: "Note", diagram: DIAGRAM },
      { layout: "content", visual: "diagram", title: "Body", body: "Copy", diagram: DIAGRAM },
    ],
  }));
  const [cover, note, content] = config.slides;
  assert.equal(cover.diagramStyle, "drawn");
  assert.equal(note.diagramStyle, undefined, "unknown styles fall back to clean");
  assert.equal(slideVisual(cover), "diagram");
  assert.equal(slideVisual(note), "diagram");
  assert.equal(slideVisual(content), "diagram", "Body 1 can explain its point with a diagram");
  assert.equal(slideVisual({ layout: "content", visual: "photos" }), undefined, "Body 1 takes diagrams, not pictures");
  assert.equal(slidePosition(cover), "bottom", "cover art sits above the headline");
  assert.equal(slidePosition(content), "top", "Body 1 leads with its point, then the figure");
  assert.equal(slidePosition({ ...content, position: "bottom" }), "bottom", "an explicit position wins");
  assert.equal(slideVisual({ layout: "cover", visual: "photos" }), undefined, "covers take diagrams, not pictures");
});

test("slides draw a hand-drawn diagram on covers and Body 2, and the clean SVG otherwise", () => {
  const render = (slide) => {
    const config = { version: 1, title: "Deck", author: "Author", slides: [slide] };
    return new JSDOM(renderToStaticMarkup(createElement(Slide, { slide, config, index: 0 })));
  };
  for (const layout of ["cover", "note"]) {
    const dom = render({ id: "s", layout, visual: "diagram", diagramStyle: "drawn", title: "Title", body: "Sub", diagram: DIAGRAM });
    try {
      const article = dom.window.document.querySelector("article");
      assert.ok(article.classList.contains("diagram-drawn"), layout);
      assert.ok(article.classList.contains("has-visual"), layout);
      assert.ok(dom.window.document.querySelector(".slide-diagram-svg svg.drawn-diagram"), layout);
    } finally { dom.window.close(); }
  }
  const dom = render({ id: "s", layout: "note", visual: "diagram", title: "Title", body: "", diagram: DIAGRAM });
  try {
    assert.ok(!dom.window.document.querySelector("article").classList.contains("diagram-drawn"));
    assert.equal(dom.window.document.querySelectorAll(".drawn-pencil").length, 0);
  } finally { dom.window.close(); }
});

test("a quiet drawing keeps the pencil and ink but drops construction lines and shadows", () => {
  const quiet = DIAGRAM.replace('<svg viewBox="0 0 800 500"', '<svg viewBox="0 0 800 500" class="quiet"');
  const { document, close } = parse(drawnSvg(sanitizeSvg(quiet), "q"));
  try {
    assert.equal(document.querySelectorAll(".drawn-construction").length, 0);
    assert.equal(document.querySelectorAll(".drawn-shadow").length, 0);
    assert.equal(document.querySelectorAll("rect.drawn-pencil").length, 2);
    assert.ok(document.querySelectorAll(".drawn-hatch").length > 0);
  } finally { close(); }
});
