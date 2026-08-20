/** Colour and ground only. It says nothing about where the text sits. */
export type TemplateId = "cinematic" | "midnight" | "paper";
export type SlideLayout = "cover" | "content" | "quote" | "closing";
/** Where the text block sits in the frame, independent of colour. */
export type SlidePosition = "top" | "middle" | "bottom";
export type SlideAlign = "left" | "center";

export type CarouselSlide = {
  id: string;
  layout: SlideLayout;
  title: string;
  body: string;
  background?: string;
  /**
   * Mean brightness of the background's top, middle and bottom third, each 0 to 1,
   * measured once when the image is chosen. The scrim is built from whichever third
   * the text actually sits over, so a bright photo is darkened and a dark one is not.
   * Absent on decks saved before this existed, which fall back to the fixed scrim.
   */
  luma?: LumaBands;
  /**
   * Sets the copy in a filled panel rather than straight on the photograph. A
   * gradient scrim fails on a busy image: a panel gives the text its own ground and
   * keeps the picture legible around it.
   */
  plate?: boolean;
  /** Overrides the carousel template, so one deck can mix photo and type-only slides. */
  template?: TemplateId;
  /** Both default from the slide type, so decks written before these existed are unchanged. */
  position?: SlidePosition;
  align?: SlideAlign;
};

/** Top, middle and bottom third of the image, each a mean brightness from 0 to 1. */
export type LumaBands = [number, number, number];

/**
 * Colour and placement used to travel together: choosing Midnight also centred the
 * text. They are separate now, and these are only the starting points a slide type
 * suggests. A cover or a closing line reads centred; a content slide reads as a
 * lower third over a photograph.
 */
export function slidePosition(slide: CarouselSlide): SlidePosition {
  return slide.position ?? (slide.layout === "content" ? "bottom" : "middle");
}

export function slideAlign(slide: CarouselSlide): SlideAlign {
  return slide.align ?? (slide.layout === "content" ? "left" : "center");
}

export type CarouselConfig = {
  version: 1;
  title: string;
  author: string;
  /** The template a slide falls back to when it does not set its own. */
  template: TemplateId;
  /**
   * A short wordmark set at the top of every slide. This is what makes a deck
   * recognisable mid-scroll: same words, same place, every slide. Deck-level on
   * purpose, so it is set once rather than retyped per slide.
   */
  mark?: string;
  slides: CarouselSlide[];
};

export function slideTemplate(slide: CarouselSlide, config: CarouselConfig) {
  return slide.template ?? config.template;
}

/** The offer every deck promotes. The mark is the category, the footer is where to go. */
export const BRAND_MARK = "AI ENGINEER";
export const BRAND_FOOTER = "AIENGINEER.CO";

export const starterConfig: CarouselConfig = {
  version: 1,
  title: "Directing AI",
  author: BRAND_FOOTER,
  mark: BRAND_MARK,
  template: "cinematic",
  slides: [
    {
      id: "starter-cover",
      layout: "cover",
      title: "AI won’t *replace* developers",
      body: "But the ones who learn to **direct** it will move much faster",
    },
    {
      id: "starter-context",
      layout: "content",
      template: "midnight",
      title: "The bottleneck moved",
      body: "Writing code is getting cheaper by the month.\n\nDeciding what to build, giving clear context, and judging the result are what still cost you something.",
    },
    {
      id: "starter-method",
      layout: "content",
      template: "paper",
      title: "Direct. Inspect. Refine.",
      body: "Give the model one concrete outcome.\n\nReview the work against evidence, not vibes.\n\nTighten the brief, then run it again.",
    },
    {
      id: "starter-close",
      layout: "closing",
      title: "Context is part of the *craft*",
      body: "Save this for your next build",
    },
  ],
};

const layouts: SlideLayout[] = ["cover", "content", "quote", "closing"];
const templates: TemplateId[] = ["cinematic", "midnight", "paper"];
const positions: SlidePosition[] = ["top", "middle", "bottom"];
const aligns: SlideAlign[] = ["left", "center"];

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function limitedText(value: unknown, label: string, limit: number, fallback = "") {
  const text = cleanText(value, fallback);
  if (text.length > limit) throw new Error(`${label} must be ${limit} characters or fewer.`);
  return text;
}

function makeId(index: number) {
  return `slide-${Date.now().toString(36)}-${index}`;
}

/** Three finite brightnesses in 0..1, or nothing. Anything else is discarded. */
function readLuma(value: unknown): LumaBands | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const bands = value.map((band) => (typeof band === "number" && Number.isFinite(band) ? clamp(band, 0, 1) : NaN));
  return bands.some(Number.isNaN) ? undefined : (bands as LumaBands);
}

/**
 * A `|` in a headline is a hard line break. `text-wrap: balance` evens the lines it
 * chooses, but it cannot know that "AI won't replace developers" wants to break after
 * "replace". This is the one lever an author has over the break, so it wins outright:
 * a title that uses it turns balancing off.
 */
export function titleLines(title: string) {
  const lines = title.split("|").map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines : [title.trim()];
}

export function parseCarouselConfig(input: string): CarouselConfig {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("That is not valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The configuration must be a JSON object.");
  }

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.slides) || record.slides.length === 0) {
    throw new Error("Add at least one slide.");
  }
  if (record.slides.length > 20) {
    throw new Error("Keep the carousel to 20 slides or fewer.");
  }

  const template = templates.includes(record.template as TemplateId)
    ? (record.template as TemplateId)
    : "cinematic";

  const slides = record.slides.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Slide ${index + 1} must be an object.`);
    }
    const slide = item as Record<string, unknown>;
    const title = limitedText(slide.title, `Slide ${index + 1} title`, 90);
    if (!title) throw new Error(`Slide ${index + 1} needs a title.`);

    // A background is either freshly uploaded bytes or a key into the image store.
    // Remote URLs stay rejected so export never depends on a third-party fetch.
    const background = cleanText(slide.background);
    if (background && !background.startsWith("data:image/") && !background.startsWith("img:")) {
      throw new Error(`Slide ${index + 1} has an unsupported background.`);
    }
    const luma = readLuma(slide.luma);

    return {
      id: cleanText(slide.id, makeId(index)),
      layout: layouts.includes(slide.layout as SlideLayout)
        ? (slide.layout as SlideLayout)
        : index === 0
          ? "cover"
          : "content",
      title,
      body: limitedText(slide.body, `Slide ${index + 1} body`, 280),
      ...(background ? { background } : {}),
      ...(luma ? { luma } : {}),
      ...(slide.plate === true ? { plate: true } : {}),
      ...(templates.includes(slide.template as TemplateId)
        ? { template: slide.template as TemplateId }
        : {}),
      ...(positions.includes(slide.position as SlidePosition)
        ? { position: slide.position as SlidePosition }
        : {}),
      ...(aligns.includes(slide.align as SlideAlign) ? { align: slide.align as SlideAlign } : {}),
    } satisfies CarouselSlide;
  });

  // Defaults to the brand rather than to nothing: everything is branded AI Engineer
  // unless a deck deliberately says otherwise.
  // The fallback has to be applied after trimming, not instead of it. A value of
  // "   " is a string, so it never reached the default and came back as nothing.
  const mark = (limitedText(record.mark, "Wordmark", 30) || BRAND_MARK).toUpperCase();

  return {
    version: 1,
    title: limitedText(record.title, "Carousel title", 100, "Untitled carousel"),
    author: (limitedText(record.author, "Author", 40) || BRAND_FOOTER).toUpperCase(),
    template,
    ...(mark ? { mark } : {}),
    slides,
  };
}

function sentenceChunks(text: string) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return paragraphs.flatMap((paragraph) => {
    const words = paragraph
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((word) => word.match(/.{1,80}/g) ?? []);
    const chunks: string[] = [];
    let current: string[] = [];

    for (const word of words) {
      const candidate = [...current, word].join(" ");
      if (current.length && (current.length >= 42 || candidate.length > 280)) {
        chunks.push(current.join(" "));
        current = [];
      }
      current.push(word);
    }

    if (current.length) chunks.push(current.join(" "));
    return chunks;
  });
}

function splitHeading(chunk: string) {
  const separator = chunk.match(/^(.{1,70}?)(?:\n|:\s+|[.!?]\s+)/);
  if (separator) {
    const title = separator[1].replace(/[.!?]$/, "").trim();
    return { title, body: chunk.slice(separator[0].length).trim() };
  }

  const words = chunk.split(/\s+/);
  if (words.length <= 12 && chunk.length <= 90) return { title: chunk, body: "" };
  const rawTitle = words.slice(0, 8).join(" ");
  return {
    title: `${rawTitle.slice(0, 89).trimEnd()}…`,
    body: words.slice(8).join(" "),
  };
}

export function generateCarouselFromText(
  source: string,
  options: Pick<CarouselConfig, "author" | "template"> = {
    author: BRAND_FOOTER,
    template: "cinematic",
  },
): CarouselConfig {
  const chunks = sentenceChunks(source);
  if (!chunks.length) throw new Error("Paste some source text first.");
  if (chunks.length > 10) {
    throw new Error(`This text needs ${chunks.length} slides. Shorten it or split it into separate carousels (10 slides maximum).`);
  }

  const parsed = chunks.map(splitHeading);
  const slides: CarouselSlide[] = parsed.map((chunk, index) => ({
    id: makeId(index),
    layout: index === 0 ? "cover" : "content",
    title: chunk.title,
    body: chunk.body,
  }));

  if (slides.length > 1) {
    slides[slides.length - 1] = { ...slides[slides.length - 1], layout: "closing" };
  }

  return {
    version: 1,
    title: slides[0].title.replace(/[.!?]$/, ""),
    author: options.author.trim().toUpperCase() || BRAND_FOOTER,
    mark: BRAND_MARK,
    template: options.template,
    slides,
  };
}

/**
 * Typewriter quotes are the single most obvious tell that type was set in a browser
 * rather than laid out. A straight apostrophe in a display serif is a vertical tick
 * where the face draws a comma, and at 100px it is impossible to miss.
 *
 * Applied at render, never to the stored text, so what the author typed is what they
 * get back in the editor and in the exported config.
 */
export function smartQuotes(text: string) {
  return text
    // Anything between two word characters is an apostrophe: don't, it's, '90s.
    .replace(/(\w)'(\w)/g, "$1\u2019$2")
    // Opening double, then closing double; order matters.
    .replace(/"(?=\w)/g, "\u201c")
    .replace(/"/g, "\u201d")
    // A leading single before a word is an opening quote unless it elides a year.
    .replace(/(^|[\s([])'(?=\d)/g, "$1\u2019")
    .replace(/(^|[\s([])'/g, "$1\u2018")
    .replace(/'/g, "\u2019")
    // Ranges and dashes, so "2 - 3" and "so -- then" stop looking like code.
    .replace(/(\d)\s*--?\s*(\d)/g, "$1\u2013$2")
    .replace(/\s--\s/g, "\u2009\u2014\u2009")
    .replace(/\.\.\./g, "\u2026");
}

export type MarkedRun = { text: string; mark: "plain" | "italic" | "accent" };

/**
 * `*word*` sets a phrase in italic, `**word**` tints it with the accent colour.
 * Both are the only styling authors can reach for, which keeps slides consistent.
 */
export function parseInlineMarks(text: string): MarkedRun[] {
  const runs: MarkedRun[] = [];
  const pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) runs.push({ text: text.slice(cursor, match.index), mark: "plain" });
    runs.push(match[1] ? { text: match[1], mark: "accent" } : { text: match[2], mark: "italic" });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) runs.push({ text: text.slice(cursor), mark: "plain" });
  return runs;
}

/** Blank lines become separate paragraphs, the way the reference slides breathe. */
export function bodyParagraphs(body: string) {
  return body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}

/**
 * Counts what a reader sees, so the emphasis markers do not push a title into a
 * smaller size band. Tolerates a missing value because the server measures slides
 * straight from parsed JSON, where an absent body is normal.
 */
function visibleLength(text: string | undefined) {
  if (typeof text !== "string") return 0;
  // What a reader sees, so neither the emphasis markers nor a break marker can push a
  // title into a smaller size. A break takes its surrounding spaces with it, because
  // "breaks | here" renders as two lines, not as a word with two spaces around it.
  return text.replace(/\*/g, "").replace(/\s*\|\s*/g, " ").trim().length;
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Type sizes are in container width, so the 520px preview and the 1080px export
 * agree exactly.
 *
 * Sizing is continuous rather than banded. Set type fills an area of roughly
 * length × size², and the text block it has to fill is a fixed share of the frame, so
 * size ≈ √(area / length) holds the block at a constant fullness however long the
 * copy runs. AREA is fitted to the golden-ratio steps this replaced: it reproduces
 * them to within a few percent at 24, 44 and 66 characters.
 *
 * Bands were the problem. deckTypeScale sizes the whole deck off its longest title,
 * so one headline crossing a band edge dropped every title by a full √φ step, 21%,
 * for one extra character. The curve moves by a fraction of a percent instead.
 */
const BODY = 3.1;
/**
 * These are font-size numbers, and font size is not what a reader sees: cap height is.
 * Playfair draws a 0.571em cap where Playfair Display drew 0.708em, so the same
 * font-size renders about a fifth smaller. AREA and the clamps are scaled by the
 * inverse of that ratio, which keeps every headline at the cap height it had before
 * the face changed while the numbers below stay honest font sizes.
 *
 * Scale these together if the face changes again. AREA moves by the square of the
 * ratio because size varies with the square root of it.
 */
const TITLE_MAX = 13.1;
const TITLE_MIN = 5.95;
const AREA = 4150;

export function titleSize(title: string | undefined) {
  const length = Math.max(visibleLength(title), 1);
  return round(clamp(Math.sqrt(AREA / length), TITLE_MIN, TITLE_MAX));
}

export function bodySize(body: string | undefined) {
  const length = visibleLength(body);
  if (length <= 110) return round(BODY * 1.128); // 3.5 — ⁴√φ
  if (length <= 200) return BODY;
  return round(BODY / 1.128); // 2.75
}

/**
 * The deck is set at one title size and one body size throughout, because a carousel
 * that changes size slide to slide reads as inconsistent even when each slide is
 * individually well fitted. The size is the one that suits the longest copy, so the
 * whole deck matches and nothing overflows.
 */
const COVER_SCALE = 1.45;
/** Past three lines a headline stops reading as a statement and starts reading as a paragraph. */
const COVER_MAX_LINES = 3;
/**
 * The cover is always the largest type in its deck, and never more than half again
 * larger than the slides behind it.
 *
 * Cover and content sizes are measured from different text, so left to themselves
 * their relationship is accidental: decks ranged from a cover 1.89x the body slides
 * to one 0.73x, which is a cover set smaller than the slides it introduces. Tying
 * the cover to the deck's own body size is what makes a shelf of decks look related.
 */
const COVER_MIN_RATIO = 1.15;
const COVER_MAX_RATIO = 1.6;

/**
 * The cover boost is a ceiling, not a promise. Applied flat, 1.45x pushed any headline
 * over about forty characters into four or five lines, which is the opposite of what
 * setting a cover large is for. So it backs off toward the base size until the longest
 * cover fits in three.
 */
function fitCoverSize(base: number, titles: (string | undefined)[]) {
  let size = round(base * COVER_SCALE);
  while (size > base && Math.max(...titles.map((title) => estimateLines(title, size))) > COVER_MAX_LINES) {
    size = round(size - 0.2);
  }
  return size;
}

export function deckTypeScale(slides: CarouselSlide[]) {
  // Covers are measured on their own. They carry the headline alone, at their own
  // multiple and their own measure, so letting a long cover title shrink every
  // content slide behind it drags the whole deck down for no reason.
  const covers = slides.filter((slide) => slide.layout === "cover");
  const content = slides.filter((slide) => slide.layout !== "cover");
  const measured = content.length ? content : slides;

  const title = Math.min(...measured.map((slide) => titleSize(slide.title)));
  const coverSlides = covers.length ? covers : measured;
  // Fit for three lines first, then hold the result inside the ratio band. The band
  // wins: a cover that has to take a fourth line is a smaller problem than a cover
  // that is not obviously the cover.
  const cover = round(clamp(
    fitCoverSize(Math.min(...coverSlides.map((slide) => titleSize(slide.title))), coverSlides.map((slide) => slide.title)),
    title * COVER_MIN_RATIO,
    title * COVER_MAX_RATIO,
  ));

  // Leading is chosen for the longest-setting slide in each group, so one four line
  // headline does not leave the rest of the deck led as if every title were two.
  const contentLines = Math.max(...measured.map((slide) => estimateLines(slide.title, title)));
  const coverLines = Math.max(...coverSlides.map((slide) => estimateLines(slide.title, cover)));

  return {
    title,
    tracking: titleTracking(title),
    leading: titleLeading(title, contentLines),
    cover,
    coverTracking: round3(titleTracking(cover) - 0.004),
    coverLeading: titleLeading(cover, coverLines),
    body: Math.min(...measured.map((slide) => bodySize(slide.body))),
  };
}

/**
 * Tracking has to move against size or the title reads like default web text.
 * A serif set at 110px needs the counters pulled in; the same face at 54px does
 * not, and tightening it there would just look cramped. These are the classic
 * display values: about -2% at the top of the scale easing to -1% at the bottom,
 * now interpolated rather than stepped so it tracks the continuous size curve.
 */
export function titleTracking(size: number) {
  // Tighter than it was, and tighter than a text face would take. A Didone set large
  // wants its letters close: the hairlines already separate the shapes, so the default
  // fit reads gappy. Roughly -2% at the bottom of the scale down to -4% at the top.
  return round3(clamp(-0.020 - (size - 6) * 0.0018, -0.042, -0.016));
}

/**
 * Leading moves against size for the same reason tracking does. Big display type
 * wants near-solid setting: the line gap a serif needs at reading size becomes a
 * gutter at 110px. Anything above 1.1 on a two-line title is the stock-HTML look.
 */
export function titleLeading(size: number, lines = 2) {
  // Leading tightens as type grows, but it has to level off rather than keep falling.
  // A straight line did keep falling: at cover sizes it returned 0.66 and even 0.44,
  // so every cover in the app was pinned to the clamp floor and the line count below
  // stopped having any effect at all. A curve flattens toward a sane display leading
  // instead of running off the bottom.
  const base = 0.88 + 1.36 / Math.max(size, 1);
  // Every line past the second opens it a little. A four line headline set as tight as
  // a two line one reads as a solid block, and descenders start colliding with the
  // caps beneath them.
  const opened = base + Math.max(0, lines - 2) * 0.035;
  // The floor sits at 0.9 rather than 0.86 because Playfair Display has a tall
  // x-height (0.514em against a 0.708em cap). Lines of a large-x face read closer
  // together than their leading says, so solid setting closes up faster.
  return round3(clamp(opened, 0.9, 1.18));
}

/**
 * How many lines a title will take at a given size, near enough to choose leading by.
 * Assumes a serif at roughly 0.46em average advance across the measure it is given.
 */
/**
 * Mean advance width of the display face over a realistic headline, in em, measured
 * from the font file rather than guessed: Playfair at opsz 96 comes out at 0.394 across
 * a sample of the copy these decks actually carry. Change this if the face changes,
 * or every line estimate drifts and the cover sizing drifts with it.
 */
const AVG_ADVANCE = 0.394;

export function estimateLines(title: string | undefined, size: number, measure = 0.88) {
  const segments = titleLines(title ?? "");
  const perLine = Math.max(1, Math.floor((100 * measure) / (size * AVG_ADVANCE)));
  return segments.reduce((total, segment) => total + Math.max(1, Math.ceil(visibleLength(segment) / perLine)), 0);
}

/* The footer (1.4cqw) is fixed in CSS so it holds steady across the deck while the
   title and body flex with their copy. */

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Tracking and leading are rounded finer than the sizes. At two decimals a 0.004em
 * nudge quantises away, and can even round back out to looser than it started.
 */
function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function aiPrompt(config: CarouselConfig) {
  return `Create a cinematic, minimal LinkedIn carousel from the source text below. Return JSON only, with no markdown fences.

Rules:
- 5 to 8 slides. One idea per slide.
- Titles: 10 words or fewer. Plain, concrete language. No colons, no hype.
- Put a "|" in a title to force a line break where the sense breaks. Use it on the cover and on any title of five words or more.
- Bodies: 45 words or fewer. Separate paragraphs with a blank line.
- Wrap one phrase per slide in *asterisks* for italic, or **double asterisks** for the accent colour. Use it sparingly.
- "template" is per slide and optional. Omit it to inherit the carousel default. Set it to "cinematic" for a photo slide, "midnight" or "paper" for a type-only slide. Mixing a couple of type-only slides into a photo deck reads well.

Use this exact shape:
${JSON.stringify(
    {
      version: 1,
      title: "Carousel title",
      author: config.author,
      template: config.template,
      slides: [
        {
          layout: "cover | content | quote | closing",
          template: "cinematic | midnight | paper",
          title: "Slide headline",
          body: "Optional supporting copy",
        },
      ],
    },
    null,
    2,
  )}

SOURCE TEXT:
`;
}
