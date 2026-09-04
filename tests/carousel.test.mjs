import assert from "node:assert/strict";
import test from "node:test";
import {
  aiPrompt,
  assertBackgroundsAvailableForExport,
  BRAND_FOOTER,
  BRAND_MARK,
  bodyParagraphs,
  deckTypeScale,
  generateCarouselFromText,
  imageCapacity,
  normalizeLayout,
  parseCarouselConfig,
  photoArrangement,
  showsBody,
  parseInlineMarks,
  sanitizeSvg,
  slideAlign,
  slideImageRefs,
  slidePosition,
  slideTemplate,
  starterConfig,
  smartQuotes,
  suggestBreak,
  titleLines,
  TYPE_SCALE,
  usesImages,
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
  assert.throws(
    () => assertBackgroundsAvailableForExport(parseCarouselConfig(JSON.stringify({
      slides: [{ title: "Grid", layout: "photos", images: ["data:image/jpeg;base64,YQ==", "img:gone"] }],
    }))),
    /slide 1 are not available/,
  );
  assert.throws(
    () => assertBackgroundsAvailableForExport(parseCarouselConfig(JSON.stringify({
      avatar: "img:gone",
      slides: [{ title: "Fine" }],
    }))),
    /avatar is not available/,
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
  assert.equal(config.author, "Owain Lewis", "case is kept as written");
  assert.equal(config.template, "editorial");
  assert.match(config.slides[1].title, /first supporting point/i);
});

test("gives generated decks the reference rhythm", () => {
  const config = generateCarouselFromText([
    "AI will not replace developers. But the ones who direct it will move faster.",
    "The bottleneck moved. Writing code is cheap now, and deciding what to build is not.",
    "Context changes everything",
    "Direct, inspect, refine",
    "Judgment still decides. Speed matters, but only judgment says whether the result is ready.",
    "Save this for your next build",
  ].join("\n\n"));

  const layouts = config.slides.map((slide) => slide.layout);
  assert.deepEqual(layouts, ["cover", "content", "poster", "poster", "content", "closing"]);
  assert.equal(config.slides[0].body, "But the ones who direct it will move faster.", "the second sentence is the cover subtitle");
  assert.equal(config.slides[2].tone, "sage", "the first poster after the setup gets the colour");
  assert.equal(config.slides[3].tone, undefined, "and only that one");
  assert.equal(config.slides[0].title, "AI will not | replace developers", "long titles get one suggested break");
  assert.equal(config.title, "AI will not replace developers", "the deck title has no break marker in it");
});

test("suggests a break before the tail of a long title and leaves short or broken ones alone", () => {
  assert.equal(suggestBreak("Four words is short"), "Four words is short");
  assert.equal(suggestBreak("Five words gets a break"), "Five words gets | a break");
  assert.equal(suggestBreak("Seven words get three at the end"), "Seven words get three | at the end");
  assert.equal(suggestBreak("An author's | own break"), "An author's | own break");
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
  assert.equal(config.template, "editorial");
  assert.equal(config.author, "Jane Doe");
  assert.equal(config.mark, BRAND_MARK, "the brand is the default series label");
  assert.equal(config.slides[0].layout, "cover");
  assert.equal(config.slides[1].layout, "content", "the old quote layout reads as content");
});

test("collapses old and unknown template names into Signifier", () => {
  const config = parseCarouselConfig(JSON.stringify({
    template: "cinematic",
    slides: [
      { title: "Photo slide" },
      { title: "Type slide", template: "paper" },
      { title: "Nonsense", template: "neon" },
    ],
  }));

  assert.equal(config.slides[0].template, undefined);
  assert.equal(config.slides[1].template, undefined);
  assert.equal(config.slides[2].template, undefined);
  assert.equal(slideTemplate(config.slides[0], config), "editorial");
  assert.equal(slideTemplate(config.slides[1], config), "editorial");
});

test("uses Signifier without redundant per-slide style overrides", () => {
  const config = parseCarouselConfig(JSON.stringify({
    template: "editorial",
    slides: [{ title: "A designed idea" }, { title: "A quiet continuation", template: "editorial" }],
  }));

  assert.equal(config.template, "editorial");
  assert.equal(config.slides[1].template, undefined);
  assert.equal(slideTemplate(config.slides[0], config), "editorial");
});

test("preserves editorial layouts, maps old names, and keeps an optional sage ground", () => {
  const config = parseCarouselConfig(JSON.stringify({
    template: "editorial",
    slides: [
      { title: "Large statement", layout: "poster", tone: "sage" },
      { title: "Two-part idea", body: "The supporting half.", layout: "split", tone: "unknown" },
      { title: "Old grid", layout: "grid" },
      { title: "Old strip", layout: "strip" },
      { title: "Old figure", layout: "figure" },
      { title: "Nonsense", layout: "hero" },
    ],
  }));

  assert.equal(config.slides[0].layout, "poster");
  assert.equal(config.slides[0].tone, "sage");
  assert.equal(config.slides[1].layout, "content");
  assert.equal(config.slides[1].tone, undefined);
  assert.equal(slideAlign(config.slides[1]), "left");
  assert.deepEqual(config.slides.slice(2).map((slide) => slide.layout), ["photos", "photos", "photos", "content"]);
  assert.equal(normalizeLayout("quote", "cover"), "content");
  assert.equal(normalizeLayout(undefined, "cover"), "cover");

  // Title-only layouts keep the body in the document; the renderer decides not to draw it.
  assert.ok(showsBody("cover") && showsBody("content") && showsBody("closing"));
  assert.ok(!showsBody("note") && !showsBody("poster") && !showsBody("diagram") && !showsBody("photos"));
  assert.equal(photoArrangement(1), "figure");
  assert.equal(photoArrangement(3), "strip");
  assert.equal(photoArrangement(4), "grid");
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

  // A cover and a content slide both read centred; only alignment differs.
  assert.equal(slidePosition(config.slides[0]), "middle");
  assert.equal(slideAlign(config.slides[0]), "center");
  assert.equal(slidePosition(config.slides[1]), "middle");
  assert.equal(slideAlign(config.slides[1]), "left");

  // Choosing a colour must not move the text: Midnight sits where any content slide does.
  assert.equal(slidePosition(config.slides[2]), slidePosition(config.slides[1]));
  assert.equal(slideAlign(config.slides[2]), slideAlign(config.slides[1]));

  assert.equal(slidePosition(config.slides[3]), "top");
  assert.equal(slideAlign(config.slides[3]), "center");

  // Unknown values fall back rather than reaching the class name.
  assert.equal(config.slides[4].position, undefined);
  assert.equal(slidePosition(config.slides[4]), "middle");
  assert.equal(slideAlign(config.slides[4]), "left");
});

test("keeps picture lists, the avatar, numbering and the arrow", () => {
  const config = parseCarouselConfig(JSON.stringify({
    avatar: "data:image/png;base64,YQ==",
    numbering: "fraction",
    arrow: false,
    slides: [
      { title: "Pictures", layout: "photos", images: ["data:image/png;base64,YQ==", " img:abc ", ""] },
      { title: "Strip", layout: "photos" },
    ],
  }));

  assert.equal(config.avatar, "data:image/png;base64,YQ==");
  assert.equal(config.numbering, "fraction");
  assert.equal(config.arrow, false);
  assert.deepEqual(config.slides[0].images, ["data:image/png;base64,YQ==", "img:abc"]);
  assert.equal(config.slides[1].images, undefined);
  assert.deepEqual(slideImageRefs(config.slides[0]), ["data:image/png;base64,YQ==", "img:abc"]);
  assert.ok(usesImages("photos") && !usesImages("content"));
  assert.equal(imageCapacity("photos"), 9);
  assert.equal(imageCapacity("content"), 0);
  assert.equal(slidePosition(config.slides[0]), "top", "pictures sit under the copy");

  const plain = parseCarouselConfig(JSON.stringify({ slides: [{ title: "Plain" }] }));
  assert.equal(plain.avatar, undefined);
  assert.equal(plain.numbering, undefined);
  assert.equal(plain.arrow, undefined);

  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Bad", images: ["https://example.com/a.jpg"] }] })),
    /unsupported image/,
  );
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Too many", images: Array(10).fill("img:a") }] })),
    /more than 9 images/,
  );
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ avatar: "https://example.com/me.jpg", slides: [{ title: "Bad" }] })),
    /avatar must be an uploaded image/,
  );
});

test("keeps a diagram drawable and strips anything that could run or fetch", () => {
  const dirty = `<svg width="800" height="500" viewBox="0 0 800 500" onload="alert(1)">
    <!-- note --><script>alert(1)</script>
    <style>@import url(https://evil.example/x.css); .a { fill: url(https://evil.example/p.png); }</style>
    <rect x="1" y="1" width="10" height="10" stroke="currentColor" onclick="alert(1)"/>
    <a href="https://evil.example"><text x="0" y="0">hi</text></a>
    <use href="#ok"/><image href="https://evil.example/i.png"/>
    <foreignObject><body>html</body></foreignObject>
  </svg>`;
  const clean = sanitizeSvg(dirty);
  assert.match(clean, /^<svg viewBox="0 0 800 500">/, "root keeps its viewBox and loses width, height and handlers");
  assert.match(clean, /<rect[^>]*stroke="currentColor"/);
  assert.doesNotMatch(clean, /script|foreignObject|onload|onclick|evil\.example|@import|<use/);
  assert.equal(sanitizeSvg("<div>not svg</div>"), "");
  assert.equal(sanitizeSvg(""), "");

  const config = parseCarouselConfig(JSON.stringify({
    slides: [{ title: "Flow", layout: "diagram", diagram: dirty }, { title: "Plain", diagram: "   " }],
  }));
  assert.equal(config.slides[0].layout, "diagram");
  assert.equal(config.slides[0].diagram, clean, "stored already sanitised");
  assert.equal(config.slides[1].diagram, undefined);
  assert.equal(slidePosition(config.slides[0]), "bottom", "the headline is a caption by default");
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Bad", layout: "diagram", diagram: "<p>no</p>" }] })),
    /not an <svg> element/,
  );
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
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Slide", body: "x".repeat(281) }] })),
    /body must be 280 characters or fewer/,
  );
});

test("produces a copyable prompt with the supported config contract", () => {
  const prompt = aiPrompt(starterConfig);
  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /cover \| content \| note \| poster \| diagram \| photos \| closing/);
  assert.match(prompt, /currentColor/);
  assert.match(prompt, /Sentence case/);
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

test("one type scale for every deck, set close to Signifier's natural fit", () => {
  const scale = deckTypeScale([
    { layout: "cover", title: "The skill that decides who ships. Nobody lists it.", body: "" },
    { layout: "content", title: "Short", body: "x".repeat(250) },
  ]);
  assert.deepEqual(scale, TYPE_SCALE, "copy length must not change the type scale");
  assert.ok(scale.cover > scale.title && scale.poster > scale.title, "cover and poster run larger");
  assert.ok(scale.tracking <= 0 && scale.tracking > -0.03, "tight enough to sit, loose enough that words stay apart");
  assert.ok(scale.leading > 0.9 && scale.leading < 1.05, "display leading");
});

test("a hard break in a headline is honoured and does not count toward its length", () => {
  assert.deepEqual(titleLines("AI won\u2019t replace developers"), ["AI won\u2019t replace developers"]);
  assert.deepEqual(titleLines("AI won\u2019t replace | developers"), ["AI won\u2019t replace", "developers"]);
  // Stray separators must not produce empty lines that would render as blank rows.
  assert.deepEqual(titleLines("Leading | | doubled |"), ["Leading", "doubled"]);
  assert.deepEqual(titleLines("|"), ["|"]);

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

  // An explicit mark wins. Case is kept: the furniture is sentence case now.
  const custom = parseCarouselConfig(JSON.stringify({
    mark: "  Something else  ",
    author: "  Owain Lewis ",
    slides: [{ title: "Slide" }],
  }));
  assert.equal(custom.mark, "Something else");
  assert.equal(custom.author, "Owain Lewis");

  // Blank falls back to the brand rather than drawing an empty strip.
  assert.equal(parseCarouselConfig(JSON.stringify({ mark: "   ", slides: [{ title: "Slide" }] })).mark, BRAND_MARK);
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ mark: "x".repeat(31), slides: [{ title: "Slide" }] })),
    /Series label must be 30 characters or fewer/,
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

test("legacy template names collapse into the image-capable Signifier system", () => {
  const config = parseCarouselConfig(JSON.stringify({
    template: "midnight",
    slides: [
      { title: "Dark", template: "cinematic" },
      { title: "Light", template: "paper" },
    ],
  }));

  assert.equal(config.template, "editorial");
  assert.equal(config.slides[0].template, undefined);
  assert.equal(config.slides[1].template, undefined);
  assert.equal(slideTemplate(config.slides[0], config), "editorial");
  assert.equal(slideTemplate(config.slides[1], config), "editorial");
});
