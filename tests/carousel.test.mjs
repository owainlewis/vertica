import assert from "node:assert/strict";
import test from "node:test";
import {
  aiPrompt,
  assertBackgroundsAvailableForExport,
  BRAND_FOOTER,
  BRAND_MARK,
  bodyParagraphs,
  carouselTheme,
  generateCarouselFromText,
  duplicateCarouselConfig,
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
  slideTone,
  smartQuotes,
  titleLines,
  usesImages,
} from "../app/carousel.ts";

test("themes survive JSON round trips and duplication without changing older decks", () => {
  const input = { slides: [{ title: "A clear design", tone: "sage", align: "center" }] };
  const legacy = parseCarouselConfig(JSON.stringify(input));
  assert.equal(legacy.theme, undefined);
  assert.equal(carouselTheme(legacy.theme), "editorial");
  const branded = parseCarouselConfig(JSON.stringify({ ...input, theme: "ai-engineer" }));
  assert.equal(branded.theme, "ai-engineer");
  assert.deepEqual(parseCarouselConfig(JSON.stringify(branded)), branded);
  assert.equal(duplicateCarouselConfig(branded).theme, "ai-engineer");
  assert.equal(branded.slides[0].tone, "sage");
  assert.equal(branded.slides[0].align, "center");
  assert.equal(parseCarouselConfig(JSON.stringify({ ...input, theme: "unknown" })).theme, "editorial");
});

test("AI Engineer chooses automatic grounds and alignment while preserving explicit choices", () => {
  const layouts = ["cover", "content", "note", "poster", "diagram", "photos", "closing"];
  assert.deepEqual(layouts.map((layout) => slideTone({ layout }, "ai-engineer")), ["black", "paper", "paper", "paper", "paper", "paper", "paper"]);
  assert.ok(layouts.every((layout) => slideTone({ layout }) === "paper"));
  assert.ok(layouts.every((layout) => slideAlign({ layout }) === "left"));
  assert.equal(slideAlign({ layout: "cover" }), "left");
  assert.equal(slideAlign({ layout: "cover", align: "center" }), "center");
  assert.equal(slideTone({ layout: "cover", tone: "paper" }, "ai-engineer"), "paper");
  assert.equal(slideTone({ layout: "content", tone: "black" }, "ai-engineer"), "black");
  assert.equal(slideTone({ layout: "poster", tone: "sage" }, "ai-engineer"), "paper");
  assert.equal(slideTone({ layout: "poster", tone: "sage" }, "editorial"), "sage");
});

test("generating slides and copying the AI prompt preserve the chosen theme", () => {
  const deck = generateCarouselFromText("Start with design. Define the problem first.\n\nCheck the result\n\nKeep learning", "Owain", "ai-engineer");
  assert.equal(deck.theme, "ai-engineer");
  assert.ok(deck.slides.every((slide) => slide.tone === undefined));
  const prompt = aiPrompt(deck);
  assert.match(prompt, /"theme": "ai-engineer"/);
  assert.match(prompt, /Geist type, a forest cover and soft-grey slides/);
  assert.doesNotMatch(prompt, /"tone": "paper \| sage \| black"/);
  assert.match(prompt, /font-family="inherit"/);
  assert.doesNotMatch(prompt, /one short serif statement|for a highlighter stroke/);
  for (const theme of ["editorial", "ai-engineer"]) {
    const instructions = aiPrompt({ ...deck, theme });
    assert.match(instructions, /Four layouts/);
    assert.match(instructions, /18px at a 390px phone width/);
    assert.match(instructions, /Bodies: 30 words or fewer/);
    assert.match(instructions, /labels and notes 48px, one text size/);
  }
});

test("generates a useful sequence without decorative colour changes or forced breaks", () => {
  const config = generateCarouselFromText([
    "AI will not replace developers. But the ones who direct it will move faster.",
    "The bottleneck moved. Writing code is cheap now, and deciding what to build is not.",
    "Context changes everything",
    "Direct, inspect, refine",
    "Judgment still decides. Speed matters, but only judgment says whether the result is ready.",
    "Save this for your next build",
  ].join("\n\n"));

  const layouts = config.slides.map((slide) => slide.layout);
  assert.deepEqual(layouts, ["cover", "content", "note", "note", "content", "closing"]);
  assert.equal(config.slides[0].body, "But the ones who direct it will move faster.", "the second sentence is the cover subtitle");
  assert.ok(config.slides.every((slide) => slide.tone === undefined), "keep the ground consistent");
  assert.equal(config.slides[0].title, "AI will not replace developers", "titles wrap naturally");
  assert.equal(config.title, "AI will not replace developers", "the deck title has no break marker in it");
});

test("generation preserves an author's explicit headline breaks", () => {
  const config = generateCarouselFromText("A useful | first step\n\nKeep the next | action clear");
  assert.equal(config.slides[0].title, "A useful | first step");
  assert.equal(config.slides[1].title, "Keep the next | action clear");
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

test("keeps picture lists and the arrow while ignoring retired avatar and numbering settings", () => {
  const config = parseCarouselConfig(JSON.stringify({
    avatar: "data:image/png;base64,YQ==",
    numbering: "fraction",
    arrow: false,
    slides: [
      { title: "Pictures", layout: "photos", images: ["data:image/png;base64,YQ==", " img:abc ", ""] },
      { title: "Strip", layout: "photos" },
    ],
  }));

  assert.equal(config.avatar, undefined);
  const veiled = parseCarouselConfig(JSON.stringify({ slides: [{ title: "A", veil: 0.25 }, { title: "B", veil: 7 }, { title: "C", veil: "x" }] }));
  assert.deepEqual(veiled.slides.map((slide) => slide.veil), [0.25, 1, undefined], "veil is clamped to 0..1 and dropped when malformed");
  assert.equal(config.numbering, undefined);
  assert.equal(config.arrow, false);
  assert.deepEqual(config.slides[0].images, ["data:image/png;base64,YQ==", "img:abc"]);
  assert.equal(config.slides[1].images, undefined);
  assert.deepEqual(slideImageRefs(config.slides[0]), ["data:image/png;base64,YQ==", "img:abc"]);
  assert.ok(usesImages({ layout: "note", visual: "photos" }) && !usesImages({ layout: "content" }));
  assert.equal(imageCapacity({ layout: "note", visual: "photos" }), 9);
  assert.equal(imageCapacity({ layout: "content" }), 0);
  assert.equal(slidePosition(config.slides[0]), "bottom", "captions sit below pictures by default");

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
  assert.doesNotThrow(
    () => parseCarouselConfig(JSON.stringify({ avatar: "https://example.com/me.jpg", slides: [{ title: "Bad" }] })),
    "retired avatar fields do not stop an old carousel from loading",
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
  assert.equal(config.slides[0].layout, "note");
  assert.equal(config.slides[0].visual, "diagram");
  assert.equal(config.slides[0].diagram, clean, "stored already sanitised");
  assert.equal(config.slides[1].diagram, undefined);
  assert.equal(slidePosition(config.slides[0]), "bottom", "the headline is a caption by default");
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ slides: [{ title: "Bad", layout: "diagram", diagram: "<p>no</p>" }] })),
    /not an <svg> element/,
  );
});


test("a diagram cannot hide a handler or a fetch behind parser quirks", () => {
  // An HTML parser treats "/" as an attribute separator and decodes entities inside
  // inline SVG, so a whitespace-only check or a raw url( check is not enough.
  const cases = [
    '<svg viewBox="0 0 1 1"><a/onclick="alert(1)"><text>x</text></a></svg>',
    '<svg viewBox="0 0 1 1"><a onClick=alert(1)><text>x</text></a></svg>',
    '<svg viewBox="0 0 1 1"><image/href="https://evil.example/x.png"/></svg>',
    '<svg viewBox="0 0 1 1"><a href="&#106;avascript:alert(1)"><text>x</text></a></svg>',
    '<svg viewBox="0 0 1 1"><style>rect{fill:url&#40;https://evil.example/t)}</style><rect/></svg>',
    '<svg viewBox="0 0 1 1"><style>rect{fill:\\75 rl(https://evil.example/t)}</style><rect/></svg>',
    '<svg viewBox="0 0 1 1"><rect style="fill:url(https://evil.example/t)"/></svg>',
    '<svg viewBox="0 0 1 1"><scr<script>ipt>alert(1)</script></svg>',
  ];
  for (const dirty of cases) {
    const clean = sanitizeSvg(dirty);
    assert.match(clean, /^<svg viewBox="0 0 1 1">/, dirty);
    assert.doesNotMatch(clean, /on[a-z]+=|evil\.example|javascript|script|url\(/i, `${dirty} -> ${clean}`);
  }
  assert.equal(
    sanitizeSvg('<svg viewBox="0 0 1 1"><a href="#here"><text x="1">a &amp; b</text></a></svg>'),
    '<svg viewBox="0 0 1 1"><a href="#here"><text x="1">a &amp; b</text></a></svg>',
    "local links, text and entities survive",
  );
});

test("diagram styles cannot target the app or position content over its controls", () => {
  const clean = sanitizeSvg('<svg viewBox="0 0 100 100"><style>body { display: none !important; }</style><rect width="100" height="100" style="position:fixed;inset:0;fill:currentColor"/><text x="5" y="20">Safe drawing</text></svg>');
  assert.doesNotMatch(clean, /<style|body|display|position|inset/);
  assert.match(clean, /fill:currentColor/);
  assert.match(clean, /Safe drawing/);
});

test("SVG styles and presentation attributes permit no external resource syntax", () => {
  const cases = [
    '<style>body { background-image:image-set("https://evil.example/pixel" 1x); }</style>',
    '<rect style=\'background-image:image-set("https://evil.example/pixel" 1x);fill:currentColor\'/>',
    '<rect style=\'fill:image-set("https://evil.example/pixel" 1x)\'/>',
    '<rect style="fill:u\\72l(https://evil.example/pixel)"/>',
    '<rect fill="url(https://evil.example/paint.svg#x)" filter="url(https://evil.example/filter.svg#x)"/>',
    '<rect cursor="url(https://evil.example/cursor),auto"/>',
    '<g xml:base="https://evil.example/"><a href="#target"><text>Local link</text></a></g>',
    '<rect style="--paint:url(https://evil.example/pixel);fill:var(--paint)"/>',
  ];
  for (const content of cases) {
    const clean = sanitizeSvg(`<svg viewBox="0 0 100 100">${content}</svg>`);
    assert.doesNotMatch(clean, /evil\.example|image-set|\\|xml:base|var\(/i, clean);
    assert.equal(sanitizeSvg(clean), clean, "a second sanitizer pass stays safe");
  }
});

test("safe inline SVG presentation, text, and local resources remain drawable", () => {
  const clean = sanitizeSvg('<svg viewBox="0 0 100 100"><defs><linearGradient id="paint"><stop offset="0" stop-color="#123456"/></linearGradient></defs><rect x="1" y="2" width="90" height="80" fill="url(#paint)" style="stroke:rgb(10,20,30);stroke-width:2;opacity:0.5"/><text x="5" y="20" font-family="Helvetica Neue, Arial, sans-serif" style="font-size:18px;text-anchor:middle">A &amp; B</text></svg>');
  assert.match(clean, /fill="url\(#paint\)"/);
  assert.match(clean, /stroke:rgb\(10,20,30\);stroke-width:2;opacity:0.5/);
  assert.match(clean, /font-family="Helvetica Neue, Arial, sans-serif"/);
  assert.match(clean, /font-size:18px;text-anchor:middle/);
  assert.match(clean, /A &amp; B/);
  assert.equal(sanitizeSvg(clean), clean);
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

test("a hard break in a headline is honoured and does not count toward its length", () => {
  assert.deepEqual(titleLines("AI won\u2019t replace developers"), ["AI won\u2019t replace developers"]);
  assert.deepEqual(titleLines("AI won\u2019t replace | developers"), ["AI won\u2019t replace", "developers"]);
  // Stray separators must not produce empty lines that would render as blank rows.
  assert.deepEqual(titleLines("Leading | | doubled |"), ["Leading", "doubled"]);
  assert.deepEqual(titleLines("|"), ["|"]);

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

test("blocks exports that would silently omit unresolved media", () => {
  const config = parseCarouselConfig(JSON.stringify({
    slides: [
      { title: "Ready", background: "data:image/jpeg;base64,YQ==" },
      { title: "Missing", background: "img:first" },
      { title: "Also missing", layout: "photos", images: ["img:second"] },
    ],
  }));
  assert.throws(() => assertBackgroundsAvailableForExport(config), /slides 2, 3 are not available/);
  assert.doesNotThrow(() => assertBackgroundsAvailableForExport({
    ...config,
    slides: config.slides.map((slide) => ({ ...slide, background: undefined, images: undefined })),
  }));
  assert.doesNotThrow(
    () => assertBackgroundsAvailableForExport(parseCarouselConfig(JSON.stringify({ avatar: "img:gone", slides: [{ title: "Fine" }] }))),
    "unused legacy avatars cannot block an export",
  );
});

test("generates a readable slide sequence from paragraphs", () => {
  const config = generateCarouselFromText(
    "A clear opening idea.\n\nThe first supporting point explains why it matters.\n\nEnd with one action the reader can take.",
    "Owain Lewis",
  );
  assert.equal(config.slides.length, 3);
  assert.equal(config.slides[0].layout, "cover");
  assert.equal(config.slides[2].layout, "closing");
  assert.equal(config.author, "Owain Lewis", "case is kept as written");
  assert.match(config.slides[1].title, /first supporting point/i);
});

test("parses AI-generated JSON, applies defaults, and maps old layout names", () => {
  const config = parseCarouselConfig(JSON.stringify({
    title: "A useful guide",
    author: "Jane Doe",
    slides: [
      { title: "Start here" },
      { layout: "quote", title: "Keep going", body: "One step at a time." },
      { layout: "split", title: "Two-part", tone: "unknown" },
      { layout: "grid", title: "Old grid" },
      { layout: "hero", title: "Nonsense" },
      { layout: "poster", title: "Loud", tone: "sage" },
    ],
  }));
  assert.equal(config.version, 1);
  assert.equal(config.author, "Jane Doe");
  assert.equal(config.mark, BRAND_MARK, "the brand is the default series label");
  assert.deepEqual(config.slides.map((slide) => slide.layout), ["cover", "content", "content", "note", "content", "note"]);
  assert.equal(config.slides[2].tone, undefined, "unknown tones are dropped");
  assert.equal(config.slides[5].tone, "sage");
  assert.equal(normalizeLayout("strip", "cover"), "note");
  assert.equal(normalizeLayout(undefined, "cover"), "cover");
  assert.ok(showsBody("cover") && showsBody("content") && showsBody("closing"));
  assert.ok(!showsBody("note") && !showsBody("poster") && !showsBody("diagram") && !showsBody("photos"));
  assert.equal(photoArrangement(1), "figure");
  assert.equal(photoArrangement(3), "grid");
  assert.equal(photoArrangement(4), "grid");
});

test("placement defaults from the slide type and stays independent of colour", () => {
  const config = parseCarouselConfig(JSON.stringify({
    slides: [
      { title: "Cover" },
      { title: "Content", layout: "content" },
      { title: "Sage content", layout: "content", tone: "sage" },
      { title: "Explicit", layout: "content", position: "top", align: "center" },
      { title: "Nonsense", layout: "content", position: "sideways", align: "justified" },
      { title: "Pictures", layout: "photos" },
      { title: "Figure", layout: "diagram" },
    ],
  }));
  assert.equal(slidePosition(config.slides[0]), "middle");
  assert.equal(slideAlign(config.slides[0]), "left");
  assert.equal(slidePosition(config.slides[1]), "middle");
  assert.equal(slideAlign(config.slides[1]), "left");
  assert.equal(slidePosition(config.slides[2]), slidePosition(config.slides[1]), "a tone never moves the text");
  assert.equal(slidePosition(config.slides[3]), "top");
  assert.equal(slideAlign(config.slides[3]), "center");
  assert.equal(config.slides[4].position, undefined, "unknown values never reach a class name");
  assert.equal(slidePosition(config.slides[5]), "bottom", "pictures and diagrams share caption placement");
  assert.equal(slidePosition(config.slides[6]), "bottom", "a diagram's headline is its caption");
});

test("visual captions offer two real positions while retaining legacy settings", () => {
  for (const visual of ["photos", "diagram"]) {
    for (const [position, expected] of [[undefined, "bottom"], ["top", "top"], ["bottom", "bottom"], ["middle", "top"]]) {
      const slide = { layout: "note", visual, position };
      assert.equal(slidePosition(slide), expected);
      assert.equal(slide.position, position);
      assert.equal(slidePosition({ ...slide, layout: "content" }), position ?? "middle", "retained visuals do not move text layouts");
    }
  }
});

test("produces a copyable prompt with the supported config contract", () => {
  const prompt = aiPrompt(parseCarouselConfig(JSON.stringify({ slides: [{ title: "Any" }] })));
  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /cover \| content \| note \| closing/);
  assert.match(prompt, /Sentence case/);
  assert.match(prompt, /currentColor/);
  assert.match(prompt, /SOURCE TEXT:/);
});

test("everything is branded AI Engineer unless a deck says otherwise", () => {
  const plain = parseCarouselConfig(JSON.stringify({ slides: [{ title: "Slide" }] }));
  assert.equal(plain.mark, BRAND_MARK);
  assert.equal(plain.author, BRAND_FOOTER);

  const custom = parseCarouselConfig(JSON.stringify({ mark: "  Something else  ", author: "  Owain Lewis ", slides: [{ title: "Slide" }] }));
  assert.equal(custom.mark, "Something else");
  assert.equal(custom.author, "Owain Lewis");

  assert.equal(parseCarouselConfig(JSON.stringify({ mark: "   ", slides: [{ title: "Slide" }] })).mark, BRAND_MARK);
  assert.throws(
    () => parseCarouselConfig(JSON.stringify({ mark: "x".repeat(31), slides: [{ title: "Slide" }] })),
    /Series label must be 30 characters or fewer/,
  );

  const generated = generateCarouselFromText("An opening idea.\n\nA supporting point that explains it.");
  assert.equal(generated.mark, BRAND_MARK);
  assert.equal(generated.author, BRAND_FOOTER);
});


test("duplicating a deck preserves its content and media with independent slide identities", () => {
  const original = parseCarouselConfig(JSON.stringify({
    title: "A".repeat(100), author: "Owain",
    slides: [
      { id: "cover", layout: "cover", title: "A headline", background: "img:photo", veil: 0.25 },
      { id: "photos", layout: "photos", title: "Pictures", images: ["img:one", "img:two"] },
    ],
  }));
  const before = structuredClone(original);
  const copy = duplicateCarouselConfig(original);
  const secondCopy = duplicateCarouselConfig(original);
  assert.equal(copy.title.length, 100);
  assert.ok(copy.title.endsWith(" (copy)"));
  assert.deepEqual(copy.slides.map((slide) => ({ ...slide, id: undefined })), original.slides.map((slide) => ({ ...slide, id: undefined })));
  const ids = [...original.slides, ...copy.slides, ...secondCopy.slides].map((slide) => slide.id);
  assert.equal(new Set(ids).size, ids.length);
  copy.slides[1].images.push("img:three");
  copy.slides[0].title = "Changed";
  assert.deepEqual(original, before, "editing the copy never changes the source deck");
});


test("slide visibility survives JSON round trips and duplication, defaulting to visible", () => {
  const config = parseCarouselConfig(JSON.stringify({
    slides: [
      { title: "Text only", layout: "note", showHeader: false, showFooter: false },
      { title: "Footer only", showHeader: false },
      { title: "Header only", showFooter: false },
      { title: "Visible", showHeader: true, showFooter: true },
      { title: "Older slide" },
      { title: "Malformed flags", showHeader: "false", showFooter: 0 },
    ],
  }));
  const visibility = (deck) => deck.slides.map(({ showHeader, showFooter }) => [showHeader !== false, showFooter !== false]);
  const expected = [[false, false], [false, true], [true, false], [true, true], [true, true], [true, true]];
  assert.deepEqual(visibility(config), expected);
  assert.deepEqual(visibility(parseCarouselConfig(JSON.stringify(config))), expected);
  assert.deepEqual(visibility(duplicateCarouselConfig(config)), expected);
});


test("retired layouts become Body 2 without losing visuals or hidden supporting copy", () => {
  const diagram = '<svg viewBox="0 0 800 500"><text x="10" y="50">A check</text></svg>';
  const original = [
    { layout: "poster", title: "A statement", body: "Retained for later" },
    { layout: "diagram", title: "A flow", diagram, body: "Hidden caption draft" },
    { layout: "photos", title: "An example", images: ["img:kept"], body: "Hidden image notes" },
  ];
  const parsed = parseCarouselConfig(JSON.stringify({ slides: original }));
  assert.deepEqual(parsed.slides.map(({ layout, visual }) => [layout, visual]), [["note", undefined], ["note", "diagram"], ["note", "photos"]]);
  assert.deepEqual(parsed.slides.map(({ body }) => body), original.map(({ body }) => body));
  assert.equal(parsed.slides[1].diagram, diagram);
  assert.deepEqual(parsed.slides[2].images, ["img:kept"]);
  assert.deepEqual(parseCarouselConfig(JSON.stringify(parsed)), parsed);
  assert.equal(usesImages({ layout: "cover", visual: "photos" }), false, "a retained visual is not painted on other layouts");
  const plain = parseCarouselConfig(JSON.stringify({ slides: [{ layout: "note", title: "Text", visual: "unknown" }] }));
  assert.equal(plain.slides[0].visual, undefined);
});
