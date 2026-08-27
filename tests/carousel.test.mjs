import assert from "node:assert/strict";
import test from "node:test";
import {
  aiPrompt,
  assertBackgroundsAvailableForExport,
  BRAND_FOOTER,
  BRAND_MARK,
  bodyParagraphs,
  bodySize,
  deckTypeScale,
  generateCarouselFromText,
  isLegacyTypeOnlyTemplate,
  parseCarouselConfig,
  parseInlineMarks,
  slideAlign,
  slidePosition,
  slideTemplate,
  starterConfig,
  technicalDemoConfig,
  estimateLines,
  smartQuotes,
  titleLeading,
  titleLines,
  titleSize,
  titleTracking,
} from "../app/carousel.ts";

test("blocks exports that would silently omit unresolved backgrounds", () => {
  const config = parseCarouselConfig(JSON.stringify({
    slides: [
      { title: "Ready", background: "data:image/jpeg;base64,YQ==" },
      { title: "Missing", background: "img:first" },
      { title: "Also missing", background: "img:second" },
    ],
  }));

  assert.throws(
    () => assertBackgroundsAvailableForExport(config),
    /slides 2, 3 are not available in this browser/,
  );
  assert.doesNotThrow(() => assertBackgroundsAvailableForExport({
    ...config,
    slides: config.slides.map((slide) => ({ ...slide, background: undefined })),
  }));
});
import { bandFor, scrimGradient, scrimPeak } from "../app/scrim.ts";

test("generates a readable slide sequence from paragraphs", () => {
  const config = generateCarouselFromText(
    "A clear opening idea.\n\nThe first supporting point explains why it matters.\n\nEnd with one action the reader can take.",
    { author: "Owain Lewis", template: "dark" },
  );

  assert.equal(config.slides.length, 3);
  assert.equal(config.slides[0].layout, "cover");
  assert.equal(config.slides[2].layout, "closing");
  assert.equal(config.author, "OWAIN LEWIS");
  assert.equal(config.template, "dark");
  assert.match(config.slides[1].title, /first supporting point/i);
});

test("rejects empty source text", () => {
  assert.throws(() => generateCarouselFromText("   \n "), /Paste some source text/);
});

test("splits long paragraphs into slide-sized chunks", () => {
  const source = Array.from({ length: 180 }, (_, index) => `word${index}`).join(" ");
  const config = generateCarouselFromText(source);

  assert.ok(config.slides.length >= 4);
  for (const slide of config.slides) {
    assert.ok(slide.title.length <= 90);
    assert.ok(slide.body.length <= 280);
    assert.ok(slide.body.split(/\s+/).filter(Boolean).length <= 42);
  }
});

test("rejects source text that would be silently truncated", () => {
  const source = Array.from({ length: 500 }, (_, index) => `word${index}`).join(" ");
  assert.throws(
    () => generateCarouselFromText(source),
    /needs \d+ slides.*10 slides maximum/,
  );
});

test("parses AI-generated JSON and applies safe defaults", () => {
  const config = parseCarouselConfig(JSON.stringify({
    title: "A useful guide",
    author: "Jane Doe",
    template: "unknown",
    slides: [{ title: "Start here" }, { layout: "quote", title: "Keep going", body: "One step at a time." }],
  }));

  assert.equal(config.version, 1);
  assert.equal(config.template, "dark");
  assert.equal(config.author, "JANE DOE");
  assert.equal(config.slides[0].layout, "cover");
  assert.equal(config.slides[1].layout, "quote");
});

test("keeps supported technical visuals and drops unknown ones", () => {
  const config = parseCarouselConfig(JSON.stringify({
    slides: [
      { title: "Loop", visual: "agent-loop" },
      { title: "Unknown", visual: "made-up-diagram" },
    ],
  }));

  assert.equal(config.slides[0].visual, "agent-loop");
  assert.equal(config.slides[1].visual, undefined);
  assert.equal(technicalDemoConfig.slides.length, 7);
  assert.equal(technicalDemoConfig.template, "light", "the direct demo should open in the course-style light theme");
  assert.ok(technicalDemoConfig.slides.every((slide) => slide.visual), "every demo slide should carry a visual");
  assert.doesNotThrow(() => parseCarouselConfig(JSON.stringify(technicalDemoConfig)));
});

test("lets a slide override the carousel template and ignores unknown ones", () => {
  const config = parseCarouselConfig(JSON.stringify({
    template: "cinematic",
    slides: [
      { title: "Photo slide" },
      { title: "Type slide", template: "paper" },
      { title: "Nonsense", template: "neon" },
    ],
  }));

  assert.equal(config.slides[0].template, undefined);
  assert.equal(config.slides[1].template, "paper");
  assert.equal(config.slides[2].template, undefined);
  assert.equal(slideTemplate(config.slides[0], config), "dark");
  assert.equal(slideTemplate(config.slides[1], config), "light");
});

test("placement is independent of colour, and defaults from the slide type", () => {
  const config = parseCarouselConfig(JSON.stringify({
    slides: [
      { title: "Cover" },
      { title: "Content", layout: "content" },
      { title: "Midnight content", layout: "content", template: "midnight" },
      { title: "Explicit", layout: "content", position: "top", align: "center" },
      { title: "Nonsense", layout: "content", position: "sideways", align: "justified" },
    ],
  }));

  // A cover reads centred, a content slide reads as a lower third.
  assert.equal(slidePosition(config.slides[0]), "middle");
  assert.equal(slideAlign(config.slides[0]), "center");
  assert.equal(slidePosition(config.slides[1]), "bottom");
  assert.equal(slideAlign(config.slides[1]), "left");

  // Choosing a colour must not move the text: Midnight sits where any content slide does.
  assert.equal(slidePosition(config.slides[2]), slidePosition(config.slides[1]));
  assert.equal(slideAlign(config.slides[2]), slideAlign(config.slides[1]));

  assert.equal(slidePosition(config.slides[3]), "top");
  assert.equal(slideAlign(config.slides[3]), "center");

  // Unknown values fall back rather than reaching the class name.
  assert.equal(config.slides[4].position, undefined);
  assert.equal(slidePosition(config.slides[4]), "bottom");
  assert.equal(slideAlign(config.slides[4]), "left");
});

test("rejects unsafe background URLs and oversized carousels", () => {
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Slide", background: "https://example.com/a.jpg" }] })),
    /unsupported background/,
  );
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Slide", background: "data:image/svg+xml;base64,PHN2Zz4=" }] })),
    /unsupported background/,
  );
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: Array.from({ length: 21 }, (_, index) => ({ title: `Slide ${index}` })) })),
    /20 slides or fewer/,
  );
  assert.equal(
    parseCarouselConfig(
      JSON.stringify({ slides: Array.from({ length: 21 }, (_, index) => ({ title: `Stored slide ${index}` })) }),
      { maximumSlides: null },
    ).slides.length,
    21,
    "app-owned decks that predate the import limit must remain loadable",
  );
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Slide", body: "x".repeat(281) }] })),
    /body must be 280 characters or fewer/,
  );
});

test("produces a copyable prompt with the supported config contract", () => {
  const prompt = aiPrompt(starterConfig);
  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /cover \| content \| quote \| closing/);
  assert.match(prompt, /execution-trace/);
  assert.match(prompt, /SOURCE TEXT:/);
});

test("reads italic and accent marks, leaving the rest as plain text", () => {
  assert.deepEqual(parseInlineMarks("AI won’t *replace* you"), [
    { text: "AI won’t ", mark: "plain" },
    { text: "replace", mark: "italic" },
    { text: " you", mark: "plain" },
  ]);
  assert.deepEqual(parseInlineMarks("**100k** views"), [
    { text: "100k", mark: "accent" },
    { text: " views", mark: "plain" },
  ]);
  assert.deepEqual(parseInlineMarks("nothing to mark"), [{ text: "nothing to mark", mark: "plain" }]);
  assert.deepEqual(parseInlineMarks("an unclosed * marker"), [{ text: "an unclosed * marker", mark: "plain" }]);
});

test("splits body copy on blank lines only", () => {
  assert.deepEqual(bodyParagraphs("One thought.\n\nA second thought."), ["One thought.", "A second thought."]);
  assert.deepEqual(bodyParagraphs("A single\nwrapped line"), ["A single\nwrapped line"]);
  assert.deepEqual(bodyParagraphs("   "), []);
});

test("keeps title and body sizes fixed as copy changes", () => {
  assert.equal(titleSize("Short headline"), titleSize("A considerably longer headline that keeps going and going"));
  assert.equal(titleSize("*Short headline*"), titleSize("Short headline"));
  assert.equal(bodySize("Brief."), bodySize("x".repeat(250)));
});

test("keeps title tracking and leading fixed", () => {
  assert.equal(titleTracking(6), titleTracking(13));
  assert.equal(titleLeading(6, 2), titleLeading(13, 5));
  assert.ok(titleTracking(8) < 0, "Helvetica titles should be set tightly");
  assert.ok(titleLeading(8) > 0.9 && titleLeading(8) < 1, "Helvetica titles should use compact leading");
});

test("sets every carousel at one fixed title and body scale", () => {
  const slides = [
    { layout: "content", title: "Short", body: "Brief." },
    { layout: "content", title: "A headline that runs a good deal longer than the first one", body: "x".repeat(250) },
    { layout: "content", title: "Middling headline", body: "Also brief." },
  ];
  const scale = deckTypeScale(slides);

  assert.equal(scale.title, titleSize(slides[0].title));
  assert.equal(scale.body, bodySize(slides[0].body));
  assert.equal(scale.tracking, titleTracking(scale.title));
  assert.equal(scale.leading, titleLeading(scale.title));

  const uniform = deckTypeScale([{ layout: "content", title: "Short", body: "Brief." }]);
  assert.deepEqual(uniform, scale, "copy length must not change the type scale");
});

test("does not size visible body copy from a hidden cover body", () => {
  const scale = deckTypeScale([
    { layout: "cover", title: "Cover", body: "x".repeat(250) },
    { layout: "content", title: "Visible copy", body: "Brief." },
  ]);

  assert.equal(scale.body, bodySize("Brief."));
});

test("a long cover title sets one uniform title scale for the whole deck", () => {
  const content = [
    { layout: "content", title: "CodeRabbit", body: "Short." },
    { layout: "content", title: "Greptile", body: "Short." },
  ];
  const withCover = deckTypeScale([
    { layout: "cover", title: "Four AI reviewers worth your time", body: "" },
    ...content,
  ]);

  assert.equal(withCover.cover, withCover.title, "cover and content use the same title size");
  assert.equal(withCover.coverTracking, withCover.tracking, "cover and content use the same tracking");
  assert.equal(withCover.coverLeading, withCover.leading, "cover and content use the same leading");

  const coversOnly = deckTypeScale([{ layout: "cover", title: "Only a cover", body: "" }]);
  assert.ok(coversOnly.title > 0 && coversOnly.cover === coversOnly.title, "a deck of covers still resolves");
  const coverWithHiddenCopy = deckTypeScale([{ layout: "cover", title: "Only a cover", body: "x".repeat(250) }]);
  assert.equal(coverWithHiddenCopy.body, bodySize(""), "hidden cover copy does not affect the unused body scale");
});

test("headline length cannot resize the carousel", () => {
  for (let length = 6; length < 90; length += 1) {
    const before = titleSize("x".repeat(length));
    const after = titleSize("x".repeat(length + 1));
    assert.equal(after, before, `character ${length + 1} changed the fixed title size`);
  }
});

test("a hard break in a headline is honoured and does not count toward its length", () => {
  assert.deepEqual(titleLines("AI won\u2019t replace developers"), ["AI won\u2019t replace developers"]);
  assert.deepEqual(titleLines("AI won\u2019t replace | developers"), ["AI won\u2019t replace", "developers"]);
  // Stray separators must not produce empty lines that would render as blank rows.
  assert.deepEqual(titleLines("Leading | | doubled |"), ["Leading", "doubled"]);
  assert.deepEqual(titleLines("|"), ["|"]);

  // The marker is punctuation for the renderer, not copy, so it cannot push a title
  // into a smaller size the way a real extra character would.
  assert.equal(titleSize("A headline that breaks | in the middle"), titleSize("A headline that breaks in the middle"));
});

test("the scrim darkens a bright photograph and leaves a dark one alone", () => {
  const bright = scrimPeak(0.9);
  const middling = scrimPeak(0.5);
  const dark = scrimPeak(0.08);

  assert.ok(bright > middling && middling > dark, "more light under the text means more scrim");
  // Cream on the result has to stay readable: black at alpha a over brightness L
  // leaves L*(1-a), which must land at or under the 0.2 target.
  for (const luma of [0.25, 0.45, 0.7, 0.95, 1]) {
    assert.ok(luma * (1 - scrimPeak(luma)) <= 0.205, `luma ${luma} is left too bright`);
  }
  // An already-dark shot keeps some separation, but must not be muddied: darkening a
  // near-black photograph as hard as a bright one is half of what the old fixed
  // gradient got wrong.
  assert.ok(dark >= 0.2 && dark <= 0.35);
  assert.ok(bright > dark * 2, "a bright photograph needs far more scrim than a dark one");
  // A deck saved before any of this was measured still gets the old fixed weight.
  assert.equal(scrimPeak(undefined), 0.9);
});

test("the scrim follows the text rather than always weighting the bottom", () => {
  const luma = [0.9, 0.9, 0.1];
  assert.equal(bandFor("top"), 0);
  assert.equal(bandFor("middle"), 1);
  assert.equal(bandFor("bottom"), 2);

  // Text over the bright top must be darkened; the same slide with text over the
  // dark bottom must not be, which one fixed gradient could never express.
  const top = scrimGradient("content", "top", luma);
  const bottom = scrimGradient("content", "bottom", luma);
  const alpha = (gradient) => Math.max(...[...gradient.matchAll(/\/ ([\d.]+)\)/g)].map((match) => Number(match[1])));
  assert.ok(alpha(top) > alpha(bottom), "the bright band should carry the heavier scrim");

  // A cover holds one centred block, so it darkens radially rather than in a band.
  assert.match(scrimGradient("cover", "middle", luma), /^radial-gradient/);
  assert.match(bottom, /^linear-gradient/);

  // Every stop has to be a real colour, not NaN leaking into the CSS.
  for (const gradient of [top, bottom, scrimGradient("cover", "middle", undefined)]) {
    assert.doesNotMatch(gradient, /NaN|undefined/);
  }
});

test("keeps a background this browser cannot resolve rather than dropping it", () => {
  // The editor round-trips through the parser, so a key with no bytes behind it has
  // to survive that trip. Losing it here is what used to erase images from a deck
  // opened in a second browser.
  const config = parseCarouselConfig(JSON.stringify({
    slides: [{ title: "Slide", background: "img:abc123" }],
  }));
  assert.equal(config.slides[0].background, "img:abc123");
});

test("keeps a measured background brightness, and discards a malformed one", () => {
  const config = parseCarouselConfig(JSON.stringify({
    slides: [
      { title: "Measured", background: "img:a", luma: [0.2, 0.5, 0.81] },
      { title: "Wrong length", background: "img:b", luma: [0.2, 0.5] },
      { title: "Not numbers", background: "img:c", luma: ["a", "b", "c"] },
      { title: "Out of range", background: "img:d", luma: [-3, 0.5, 42] },
      { title: "Never measured", background: "img:e" },
    ],
  }));

  assert.deepEqual(config.slides[0].luma, [0.2, 0.5, 0.81]);
  assert.equal(config.slides[1].luma, undefined);
  assert.equal(config.slides[2].luma, undefined);
  assert.deepEqual(config.slides[3].luma, [0, 0.5, 1], "out of range values are clamped, not dropped");
  assert.equal(config.slides[4].luma, undefined);
});

test("everything is branded AI Engineer unless a deck says otherwise", () => {
  const plain = parseCarouselConfig(JSON.stringify({ slides: [{ title: "Slide" }] }));
  assert.equal(plain.mark, BRAND_MARK, "an unmarked deck still carries the brand");
  assert.equal(plain.author, BRAND_FOOTER, "and the footer still carries the offer");

  // An explicit mark wins, and is normalised the way the footer name is.
  const custom = parseCarouselConfig(JSON.stringify({
    mark: "  something else  ",
    author: "  owain lewis ",
    slides: [{ title: "Slide" }],
  }));
  assert.equal(custom.mark, "SOMETHING ELSE");
  assert.equal(custom.author, "OWAIN LEWIS");

  // Blank falls back to the brand rather than drawing an empty strip.
  assert.equal(parseCarouselConfig(JSON.stringify({ mark: "   ", slides: [{ title: "Slide" }] })).mark, BRAND_MARK);
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ mark: "x".repeat(31), slides: [{ title: "Slide" }] })),
    /Wordmark must be 30 characters or fewer/,
  );

  // A generated deck is branded too, not just a parsed one.
  const generated = generateCarouselFromText("An opening idea.\n\nA supporting point that explains it.");
  assert.equal(generated.mark, BRAND_MARK);
  assert.equal(generated.author, BRAND_FOOTER);
  assert.equal(starterConfig.mark, BRAND_MARK);
  assert.equal(starterConfig.author, BRAND_FOOTER);
});

test("a text plate is opt-in and only ever true", () => {
  const config = parseCarouselConfig(JSON.stringify({
    slides: [
      { title: "Panelled", plate: true },
      { title: "Plain" },
      { title: "Truthy but not true", plate: "yes" },
      { title: "Off", plate: false },
    ],
  }));

  assert.equal(config.slides[0].plate, true);
  assert.equal(config.slides[1].plate, undefined);
  // A string would reach the class name and silently switch the layout, so only the
  // real boolean counts.
  assert.equal(config.slides[2].plate, undefined);
  assert.equal(config.slides[3].plate, undefined);
});

test("sets typographic quotes, dashes and ellipses at render time", () => {
  assert.equal(smartQuotes("You don't have a model problem"), "You don\u2019t have a model problem");
  assert.equal(smartQuotes('He said "no" twice'), "He said \u201cno\u201d twice");
  assert.equal(smartQuotes("'quoted' aside"), "\u2018quoted\u2019 aside");
  assert.equal(smartQuotes("shipping in the '90s"), "shipping in the \u201990s");
  assert.equal(smartQuotes("wait for it..."), "wait for it\u2026");
  assert.equal(smartQuotes("takes 2-3 weeks"), "takes 2\u20133 weeks");
  // Plain prose must come back untouched, marks included.
  assert.equal(smartQuotes("Build the *context*"), "Build the *context*");
});

test("leading stays fixed as a headline takes more lines", () => {
  const size = 8;
  assert.equal(titleLeading(size, 4), titleLeading(size, 2));
  assert.equal(titleLeading(size, 2), titleLeading(size, 1));
  for (const lines of [1, 2, 3, 4, 6]) {
    const value = titleLeading(size, lines);
    assert.ok(value > 0.9 && value < 1, `${value} is not compact display leading`);
  }
  assert.equal(titleLeading(size), titleLeading(size, 2));
});

test("estimates line count from the copy, the size and the hard breaks", () => {
  // A short headline at display size is one line; the same words at the same size
  // with a break in them are two.
  assert.equal(estimateLines("Taste is the moat", 10.6), 1);
  assert.equal(estimateLines("Taste is | the moat", 10.6), 2);
  // Long copy at a big size has to wrap several times.
  assert.ok(estimateLines("The skill that decides who ships. Nobody lists it.", 10.6) >= 3);
  // And the same copy set small fits in fewer.
  assert.ok(
    estimateLines("The skill that decides who ships. Nobody lists it.", 5) <
    estimateLines("The skill that decides who ships. Nobody lists it.", 10.6),
  );
});

test("short and long covers share one leading", () => {
  const long = deckTypeScale([{ layout: "cover", title: "The skill that decides who ships. Nobody lists it.", body: "" }]);
  const short = deckTypeScale([{ layout: "cover", title: "Taste is the moat", body: "" }]);
  assert.equal(long.coverLeading, short.coverLeading);
});

test("legacy template names remain readable and normalize at render time", () => {
  const config = parseCarouselConfig(JSON.stringify({
    template: "midnight",
    slides: [
      { title: "Dark", template: "cinematic" },
      { title: "Light", template: "paper" },
    ],
  }));

  // Keep the source value in the parsed config so old type-only backgrounds can
  // still be suppressed by Slide. slideTemplate is the canonical visual mode.
  assert.equal(config.template, "midnight");
  assert.equal(config.slides[0].template, "cinematic");
  assert.equal(config.slides[1].template, "paper");
  assert.equal(slideTemplate(config.slides[0], config), "dark");
  assert.equal(slideTemplate(config.slides[1], config), "light");
  assert.equal(isLegacyTypeOnlyTemplate("midnight"), true);
  assert.equal(isLegacyTypeOnlyTemplate("paper"), true);
  assert.equal(isLegacyTypeOnlyTemplate("cinematic"), false);
  assert.equal(isLegacyTypeOnlyTemplate("dark"), false);
});
