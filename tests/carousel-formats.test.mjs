import assert from "node:assert/strict";
import test from "node:test";
import { parseCarouselConfig, duplicateCarouselConfig, carouselFormat, aiPrompt } from "../app/carousel.ts";

test("Cinematic format and labels round-trip through JSON and duplication", () => {
  const config = parseCarouselConfig(JSON.stringify({
    theme: "cinematic", format: "video", slides: [{ title: "Build with intent", label: "Rule 01" }],
  }));
  const copy = duplicateCarouselConfig(config);
  const roundTrip = parseCarouselConfig(JSON.stringify(copy));
  assert.equal(roundTrip.theme, "cinematic");
  assert.equal(roundTrip.format, "video");
  assert.equal(roundTrip.slides[0].label, "Rule 01");
  assert.notEqual(roundTrip.slides[0].id, config.slides[0].id);
  assert.match(aiPrompt(config), /"format": "video"/);
  assert.doesNotMatch(aiPrompt(config), /consistent paper ground/);
});

test("old and unknown formats default to still images; labels have a finite length", () => {
  const config = parseCarouselConfig(JSON.stringify({ slides: [{ title: "Old deck" }] }));
  assert.equal(config.format, undefined);
  assert.equal(carouselFormat(config.format), "image");
  assert.equal(carouselFormat("reel"), "image");
  assert.throws(() => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Too long", label: "x".repeat(31) }] })), /label must be 30/);
});
