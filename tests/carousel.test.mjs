import assert from "node:assert/strict";
import test from "node:test";
import {
  aiPrompt,
  generateCarouselFromText,
  parseCarouselConfig,
  starterConfig,
} from "../app/carousel.ts";

test("generates a readable slide sequence from paragraphs", () => {
  const config = generateCarouselFromText(
    "A clear opening idea.\n\nThe first supporting point explains why it matters.\n\nEnd with one action the reader can take.",
    { author: "Owain Lewis", template: "signal" },
  );

  assert.equal(config.slides.length, 3);
  assert.equal(config.slides[0].layout, "cover");
  assert.equal(config.slides[2].layout, "closing");
  assert.equal(config.author, "OWAIN LEWIS");
  assert.equal(config.template, "signal");
  assert.match(config.slides[1].title, /first supporting point/i);
});

test("rejects empty source text", () => {
  assert.throws(() => generateCarouselFromText("   \n "), /Paste some source text/);
});

test("parses AI-generated JSON and applies safe defaults", () => {
  const config = parseCarouselConfig(JSON.stringify({
    title: "A useful guide",
    author: "Jane Doe",
    template: "unknown",
    slides: [{ title: "Start here" }, { layout: "quote", title: "Keep going", body: "One step at a time." }],
  }));

  assert.equal(config.version, 1);
  assert.equal(config.template, "editorial");
  assert.equal(config.author, "JANE DOE");
  assert.equal(config.slides[0].layout, "cover");
  assert.equal(config.slides[1].layout, "quote");
});

test("rejects unsafe background URLs and oversized carousels", () => {
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Slide", background: "https://example.com/a.jpg" }] })),
    /unsupported background/,
  );
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: Array.from({ length: 21 }, (_, index) => ({ title: `Slide ${index}` })) })),
    /20 slides or fewer/,
  );
});

test("produces a copyable prompt with the supported config contract", () => {
  const prompt = aiPrompt(starterConfig);
  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /cover \| content \| quote \| closing/);
  assert.match(prompt, /SOURCE TEXT:/);
});
