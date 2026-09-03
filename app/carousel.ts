import { isSupportedImageDataUrl } from "./image-formats.ts";

/** Colour and ground only. It says nothing about where the text sits. */
export type TemplateId = "editorial";
export type SlideLayout = "cover" | "content" | "quote" | "poster" | "split" | "closing";
export type EditorialTone = "paper" | "sage" | "black";
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
  /** Overrides the carousel colour mode for one slide when a contrast is deliberate. */
  template?: TemplateId;
  /** Both default from the slide type, so decks written before these existed are unchanged. */
  position?: SlidePosition;
  align?: SlideAlign;
  /** An optional editorial ground. Other templates ignore it. */
  tone?: EditorialTone;
};

/** Top, middle and bottom third of the image, each a mean brightness from 0 to 1. */
export type LumaBands = [number, number, number];

/**
 * Ground and placement stay separate: choosing a tone never moves the text.
 * These are only the starting points a slide type suggests. A cover or a closing line
 * reads centred; a content slide reads as a lower third over a photograph.
 */
export function slidePosition(slide: CarouselSlide): SlidePosition {
  return slide.position ?? (slide.layout === "content" ? "bottom" : "middle");
}

export function slideAlign(slide: CarouselSlide): SlideAlign {
  return slide.align ?? (slide.layout === "content" || slide.layout === "split" ? "left" : "center");
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
  return normalizeTemplate(slide.template ?? config.template);
}

/**
 * Every saved template name now enters the same Signifier system. Accepting legacy
 * values keeps old documents readable without preserving competing visual styles.
 */
export function normalizeTemplate(value: unknown): TemplateId {
  void value;
  return "editorial";
}

/** Legacy decks now use the same image-capable Signifier system. */
export function isLegacyTypeOnlyTemplate(value: unknown) {
  void value;
  return false;
}

/** Stops an export that would silently paint an unresolved local image as blank. */
export function assertBackgroundsAvailableForExport(config: CarouselConfig) {
  const missing = config.slides
    .map((slide, index) => (slide.background?.startsWith("img:") ? index + 1 : null))
    .filter((index): index is number => index !== null);

  if (!missing.length) return;
  const slides = missing.length === 1 ? `slide ${missing[0]}` : `slides ${missing.join(", ")}`;
  throw new Error(
    `Background images for ${slides} are not available in this browser. Open this carousel where the images were uploaded, or replace them before exporting.`,
  );
}

/** The offer every deck promotes. The mark is the category, the footer is where to go. */
export const BRAND_MARK = "AI ENGINEER";
export const BRAND_FOOTER = "AIENGINEER.CO";

export const starterConfig: CarouselConfig = {
  version: 1,
  title: "Directing AI",
  author: BRAND_FOOTER,
  mark: BRAND_MARK,
  template: "editorial",
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
      title: "The bottleneck moved",
      body: "Writing code is getting cheaper by the month.\n\nDeciding what to build, giving clear context, and judging the result are what still cost you something.",
    },
    {
      id: "starter-method",
      layout: "content",
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

const layouts: SlideLayout[] = ["cover", "content", "quote", "poster", "split", "closing"];
const positions: SlidePosition[] = ["top", "middle", "bottom"];
const aligns: SlideAlign[] = ["left", "center"];
const editorialTones: EditorialTone[] = ["paper", "sage", "black"];

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

  // Template names from older documents are intentionally collapsed into the one
  // current visual system instead of preserving hidden style modes.
  const template: TemplateId = "editorial";

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
    if (background && !isSupportedImageDataUrl(background) && !background.startsWith("img:")) {
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
      ...(positions.includes(slide.position as SlidePosition)
        ? { position: slide.position as SlidePosition }
        : {}),
      ...(aligns.includes(slide.align as SlideAlign) ? { align: slide.align as SlideAlign } : {}),
      ...(editorialTones.includes(slide.tone as EditorialTone) ? { tone: slide.tone as EditorialTone } : {}),
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
    template: "editorial",
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
    template: normalizeTemplate(options.template),
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

/** Type sizes are in container width, so preview and export agree exactly. */
const TITLE = 8;
const BODY = 3.1;
const TITLE_TRACKING = -0.035;
const TITLE_LEADING = 0.96;

export function titleSize(title: string | undefined) {
  void title;
  return TITLE;
}

export function bodySize(body: string | undefined) {
  void body;
  return BODY;
}

/**
 * Every carousel shares the same title and body scale. Copy can wrap to more lines,
 * but it cannot make one cover look louder than the next in the gallery.
 */
export function deckTypeScale(slides: CarouselSlide[]) {
  void slides;
  return {
    title: TITLE,
    tracking: TITLE_TRACKING,
    leading: TITLE_LEADING,
    cover: TITLE,
    coverTracking: TITLE_TRACKING,
    coverLeading: TITLE_LEADING,
    body: BODY,
  };
}

export function titleTracking(size: number) {
  void size;
  return TITLE_TRACKING;
}

export function titleLeading(size: number, lines = 2) {
  void size;
  void lines;
  return TITLE_LEADING;
}

/**
 * How many lines a title will take at a given size.
 *
 * Helvetica's mean advance across ordinary English display copy is about 0.46em.
 * This estimate is used for tests and line-count guidance, not for resizing type.
 */
const AVG_ADVANCE = 0.46;

export function estimateLines(title: string | undefined, size: number, measure = 0.88) {
  const segments = titleLines(title ?? "");
  const perLine = Math.max(1, Math.floor((100 * measure) / (size * AVG_ADVANCE)));
  return segments.reduce((total, segment) => total + Math.max(1, Math.ceil(visibleLength(segment) / perLine)), 0);
}

/* The footer (1.4cqw) is fixed in CSS so it holds steady across every deck. */

export function aiPrompt(config: CarouselConfig) {
  return `Create a minimal LinkedIn carousel from the source text below. Return JSON only, with no markdown fences.

Rules:
- 5 to 8 slides. One idea per slide.
- Titles: 10 words or fewer. Plain, concrete language. No colons, no hype.
- Put a "|" in a title to force a line break where the sense breaks. Use it on the cover and on any title of five words or more.
- Bodies: 45 words or fewer. Separate paragraphs with a blank line.
- Wrap one phrase per slide in *asterisks* for italic, or **double asterisks** for the accent colour. Use it sparingly.
- There is one visual style: Signifier editorial typography on a visible column grid. Set "template" to "editorial" or omit it.
- "poster" makes one short idea deliberately oversized. "split" places the title and body on opposing parts of the grid. Use each no more than once.
- "tone" is optional. Use "sage" or "black" on one emphasis slide at most; otherwise omit it for paper. Every text element on a page uses the same ink colour.

Use this exact shape:
${JSON.stringify(
    {
      version: 1,
      title: "Carousel title",
      author: config.author,
      template: config.template,
      slides: [
        {
          layout: "cover | content | quote | poster | split | closing",
          template: "editorial",
          tone: "paper | sage | black",
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
