import { isSupportedImageDataUrl } from "./image-formats.ts";

/** One visual system. Kept as a type so saved documents stay readable. */
export type TemplateId = "editorial";
/**
 * Seven layouts, each with one job:
 *   cover    big headline, one-line subtitle at the foot
 *   content  headline and copy, the workhorse
 *   note     one plain sans statement, no headline
 *   poster   one short serif statement, oversized
 *   diagram  an SVG figure with the headline as its caption
 *   photos   pictures on the paper with the headline above; one, a strip, or a grid
 *   closing  headline and one line
 * Note, poster, diagram and photos draw the title only. Their body is kept but never
 * rendered, so nothing can collide with the figure. Older names (quote, split, grid,
 * strip, figure) map onto these when a document is read.
 */
export type SlideLayout = "cover" | "content" | "note" | "poster" | "diagram" | "photos" | "closing";
export type EditorialTone = "paper" | "sage" | "black";
/** Where the text block sits in the frame, independent of colour. */
export type SlidePosition = "top" | "middle" | "bottom";
export type SlideAlign = "left" | "center";
/** "page" prints a bare "02"; "fraction" prints "02 / 06". */
export type Numbering = "page" | "fraction";

export type CarouselSlide = {
  id: string;
  layout: SlideLayout;
  title: string;
  body: string;
  background?: string;
  /**
   * Pictures for the grid, strip and figure layouts, in reading order. Each is a
   * data URL or an `img:` key, exactly like `background`. Other layouts keep the
   * list so switching layout and back loses nothing.
   */
  images?: string[];
  /**
   * Inline SVG for the diagram layout, drawn as a centred figure. Sanitised on the
   * way in: no scripts, no event handlers, no external references. Draw with
   * currentColor so the diagram takes the slide's ink on any ground.
   */
  diagram?: string;
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
  /** Kept for old documents. Every value resolves to the one system. */
  template?: TemplateId;
  /** Both default from the slide type, so decks written before these existed are unchanged. */
  position?: SlidePosition;
  align?: SlideAlign;
  /** An optional editorial ground. */
  tone?: EditorialTone;
};

/** Top, middle and bottom third of the image, each a mean brightness from 0 to 1. */
export type LumaBands = [number, number, number];

/** Layouts that draw the slide's `images` list. */
export function usesImages(layout: SlideLayout) {
  return layout === "photos";
}

/** How many pictures a layout can show. Extra ones are kept but not drawn. */
export function imageCapacity(layout: SlideLayout) {
  return layout === "photos" ? 9 : 0;
}

/** How a photos slide arranges its pictures: one figure, a strip of two or three, or a grid. */
export function photoArrangement(count: number): "figure" | "strip" | "grid" {
  if (count <= 1) return "figure";
  if (count <= 3) return "strip";
  return "grid";
}

/** Layouts whose supporting copy is drawn. The rest are title only, on purpose. */
export function showsBody(layout: SlideLayout) {
  return layout === "cover" || layout === "content" || layout === "closing";
}

const LEGACY_LAYOUTS: Record<string, SlideLayout> = {
  quote: "content",
  split: "content",
  grid: "photos",
  strip: "photos",
  figure: "photos",
};

/** Reads any layout name a saved document might carry. Unknown names fall back. */
export function normalizeLayout(value: unknown, fallback: SlideLayout): SlideLayout {
  if (typeof value !== "string") return fallback;
  if ((layouts as string[]).includes(value)) return value as SlideLayout;
  return LEGACY_LAYOUTS[value] ?? fallback;
}

/**
 * Ground and placement stay separate: choosing a tone never moves the text.
 * These are only the starting points a slide type suggests. A cover or a closing line
 * reads centred, and so does a content slide. Picture layouts put the sentence above
 * the pictures, so they read from the top.
 */
export function slidePosition(slide: CarouselSlide): SlidePosition {
  if (slide.position) return slide.position;
  // Pictures hang under their title, so that title starts high. Everything else
  // sits in the middle of the page, the way the reference decks set their copy.
  if (usesImages(slide.layout)) return "top";
  // A diagram's headline reads as a caption under the figure, like a plate in a book.
  if (slide.layout === "diagram") return "bottom";
  return "middle";
}

export function slideAlign(slide: CarouselSlide): SlideAlign {
  if (slide.align) return slide.align;
  return slide.layout === "content" || slide.layout === "note" ? "left" : "center";
}

export type CarouselConfig = {
  version: 1;
  title: string;
  author: string;
  /** The template a slide falls back to when it does not set its own. */
  template: TemplateId;
  /**
   * A short series label set at the top of every slide. This is what makes a deck
   * recognisable mid-scroll: same words, same place, every slide. Deck-level on
   * purpose, so it is set once rather than retyped per slide.
   */
  mark?: string;
  /** A small round portrait drawn bottom-left on every slide. Data URL or `img:` key. */
  avatar?: string;
  /** Defaults to a bare page number, which is quieter than a fraction. */
  numbering?: Numbering;
  /** A swipe arrow bottom-right on every slide but the last. Defaults on. */
  arrow?: boolean;
  slides: CarouselSlide[];
};

export function slideTemplate(slide: CarouselSlide, config: CarouselConfig): TemplateId {
  void slide;
  void config;
  return "editorial";
}

/** Every image reference a slide can carry, whether painted or not. */
export function slideImageRefs(slide: CarouselSlide) {
  return [slide.background, ...(slide.images ?? [])].filter((value): value is string => Boolean(value));
}

/** Stops an export that would silently paint an unresolved local image as blank. */
export function assertBackgroundsAvailableForExport(config: CarouselConfig) {
  const missing = config.slides
    .map((slide, index) => (slideImageRefs(slide).some((ref) => ref.startsWith("img:")) ? index + 1 : null))
    .filter((index): index is number => index !== null);

  if (config.avatar?.startsWith("img:")) {
    throw new Error("The deck avatar is not available in this browser. Choose it again from Media before exporting.");
  }
  if (!missing.length) return;
  const slides = missing.length === 1 ? `slide ${missing[0]} are` : `slides ${missing.join(", ")} are`;
  throw new Error(
    `Images for ${slides} not available in this browser. Open this carousel where the images were uploaded, or replace them before exporting.`,
  );
}

/** The offer every deck promotes. The mark is the series, the footer is where to go. */
export const BRAND_MARK = "AI Engineer";
export const BRAND_FOOTER = "aiengineer.co";

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
      title: "AI won’t *replace* | developers",
      body: "But the ones who learn to direct it will move much faster",
    },
    {
      id: "starter-context",
      layout: "content",
      title: "The bottleneck moved",
      body: "Writing code is getting cheaper by the month.\n\nDeciding what to build, giving clear context, and judging the result are what still cost you something.",
    },
    {
      id: "starter-method",
      layout: "poster",
      tone: "sage",
      title: "Direct. Inspect. *Refine.*",
      body: "",
    },
    {
      id: "starter-close",
      layout: "closing",
      title: "Context is part of the *craft*",
      body: "Save this for your next build",
    },
  ],
};

const layouts: SlideLayout[] = ["cover", "content", "note", "poster", "diagram", "photos", "closing"];
const MAX_DIAGRAM_CHARS = 60_000;
const positions: SlidePosition[] = ["top", "middle", "bottom"];
const aligns: SlideAlign[] = ["left", "center"];
const editorialTones: EditorialTone[] = ["paper", "sage", "black"];
const MAX_IMAGES = 9;

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
 * An image is either freshly uploaded bytes or a key into the image store. Remote
 * URLs stay rejected so export never depends on a third-party fetch.
 */
function isImageRef(value: string) {
  return isSupportedImageDataUrl(value) || value.startsWith("img:");
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

  const slides = record.slides.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Slide ${index + 1} must be an object.`);
    }
    const slide = item as Record<string, unknown>;
    // Room for a note, which is a whole sentence rather than a headline.
    const title = limitedText(slide.title, `Slide ${index + 1} title`, 120);
    if (!title) throw new Error(`Slide ${index + 1} needs a title.`);

    const background = cleanText(slide.background);
    if (background && !isImageRef(background)) {
      throw new Error(`Slide ${index + 1} has an unsupported background.`);
    }

    const images = Array.isArray(slide.images)
      ? slide.images.map((entry) => cleanText(entry)).filter(Boolean)
      : [];
    if (images.some((entry) => !isImageRef(entry))) {
      throw new Error(`Slide ${index + 1} has an unsupported image.`);
    }
    if (images.length > MAX_IMAGES) {
      throw new Error(`Slide ${index + 1} has more than ${MAX_IMAGES} images.`);
    }
    const luma = readLuma(slide.luma);

    const diagram = typeof slide.diagram === "string" ? sanitizeSvg(slide.diagram) : "";
    if (typeof slide.diagram === "string" && slide.diagram.trim() && !diagram) {
      throw new Error(`Slide ${index + 1} has a diagram that is not an <svg> element.`);
    }
    if (diagram.length > MAX_DIAGRAM_CHARS) {
      throw new Error(`Slide ${index + 1} diagram must be ${MAX_DIAGRAM_CHARS} characters or fewer.`);
    }

    return {
      id: cleanText(slide.id, makeId(index)),
      layout: normalizeLayout(slide.layout, index === 0 ? "cover" : "content"),
      title,
      body: limitedText(slide.body, `Slide ${index + 1} body`, 280),
      ...(background ? { background } : {}),
      ...(images.length ? { images } : {}),
      ...(diagram ? { diagram } : {}),
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
  // unless a deck deliberately says otherwise. Case is kept as written: the reference
  // furniture is sentence case, and shouting it in capitals was the loudest thing on
  // the page.
  const mark = limitedText(record.mark, "Series label", 30) || BRAND_MARK;
  const avatar = cleanText(record.avatar);
  if (avatar && !isImageRef(avatar)) throw new Error("The avatar must be an uploaded image.");

  return {
    version: 1,
    title: limitedText(record.title, "Carousel title", 100, "Untitled carousel"),
    author: limitedText(record.author, "Author", 40) || BRAND_FOOTER,
    template: "editorial",
    mark,
    ...(avatar ? { avatar } : {}),
    ...(record.numbering === "fraction" ? { numbering: "fraction" as const } : {}),
    ...(record.arrow === false ? { arrow: false } : {}),
    slides,
  };
}

/**
 * Keeps an SVG drawable and nothing else. Scripts, event handlers, embedded HTML
 * and any reference that would leave the document are removed, so a pasted diagram
 * can draw but cannot run or fetch. Returns "" for anything that is not an <svg>.
 *
 * Regex rather than a DOM parser because this also runs on the server, where the
 * gallery is rendered and there is no DOM. The rules are deliberately blunt.
 */
export function sanitizeSvg(input: string) {
  const trimmed = input.trim();
  if (!/^<svg[\s>]/i.test(trimmed) || !/<\/svg>\s*$/i.test(trimmed)) return "";
  let svg = trimmed
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    // Elements that execute or embed. Paired and self-closing forms.
    .replace(/<(script|foreignObject|iframe|object|embed|use|set|animate\w*)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|foreignObject|iframe|object|embed|use|set|animate\w*)\b[^>]*\/?>/gi, "")
    // Event handlers, and any attribute that carries a URL out of the document.
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|xlink:href|src)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*'|(?!#)[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    // Stylesheets that would fetch: url() and @import.
    .replace(/url\s*\((?!\s*['"]?#)[^)]*\)/gi, "none")
    .replace(/@import[^;]*;?/gi, "");
  // The slide sizes the drawing, so a fixed width or height on the root only fights it.
  svg = svg.replace(/^<svg\b([^>]*)>/i, (_, attrs: string) =>
    `<svg${attrs.replace(/\s+(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")}>`);
  return svg;
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

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Puts the one break an author gets where a balanced wrap rarely lands it: before the
 * last two words of a five or six word title, before the last three of a longer one.
 * The tail line then carries the sense rather than a stranded word. A title that
 * already has a break is the author's, and is left alone.
 */
export function suggestBreak(title: string) {
  if (title.includes("|")) return title;
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length < 5) return title;
  const tail = words.length >= 7 ? 3 : 2;
  return `${words.slice(0, -tail).join(" ")} | ${words.slice(-tail).join(" ")}`;
}

/** A short, complete statement with nothing under it is a poster, not a content slide. */
const POSTER_MAX_WORDS = 8;

/**
 * Builds the rhythm the reference decks have from plain paragraphs: a cover with a
 * subtitle, content slides that explain, a short statement set as a poster now and
 * then, one of them on a sage ground, and a close.
 */
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
  const last = parsed.length - 1;
  let sageUsed = false;

  const slides: CarouselSlide[] = parsed.map((chunk, index) => {
    const title = suggestBreak(chunk.title);
    if (index === 0) return { id: makeId(index), layout: "cover", title, body: chunk.body };
    if (index === last && parsed.length > 1) return { id: makeId(index), layout: "closing", title, body: chunk.body };

    const poster = !chunk.body && wordCount(chunk.title) <= POSTER_MAX_WORDS;
    if (!poster) return { id: makeId(index), layout: "content", title, body: chunk.body };

    // The first big statement after the setup gets the colour, and only that one, so
    // the sage slide stays an event rather than a pattern.
    const tone = !sageUsed && index >= 2 ? "sage" : undefined;
    if (tone) sageUsed = true;
    return { id: makeId(index), layout: "poster", title, body: "", ...(tone ? { tone } : {}) };
  });

  return {
    version: 1,
    title: titleLines(slides[0].title).join(" ").replace(/[.!?]$/, ""),
    author: options.author.trim() || BRAND_FOOTER,
    mark: BRAND_MARK,
    template: "editorial",
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
    .replace(/(\w)'(\w)/g, "$1’$2")
    // Opening double, then closing double; order matters.
    .replace(/"(?=\w)/g, "“")
    .replace(/"/g, "”")
    // A leading single before a word is an opening quote unless it elides a year.
    .replace(/(^|[\s([])'(?=\d)/g, "$1’")
    .replace(/(^|[\s([])'/g, "$1‘")
    .replace(/'/g, "’")
    // Ranges and dashes, so "2 - 3" and "so -- then" stop looking like code.
    .replace(/(\d)\s*--?\s*(\d)/g, "$1–$2")
    .replace(/\s--\s/g, " — ")
    .replace(/\.\.\./g, "…");
}

export type MarkedRun = { text: string; mark: "plain" | "italic" | "accent" };

/**
 * `*word*` sets a phrase in italic, `**word**` paints a highlighter stroke behind it.
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

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

/**
 * One type scale for every carousel, in container width so the preview and the
 * export are the same drawing at different sizes. Signifier is set close to its
 * natural fit: the tight tracking it used to get made "How I built" read as one word.
 */
export const TYPE_SCALE = {
  /** Headline size on content and closing slides. */
  title: 10.2,
  /** The cover runs larger and is the only headline that does. */
  cover: 12.4,
  /** Posters treat the sentence as the picture. */
  poster: 13.2,
  body: 3.3,
  tracking: -0.02,
  leading: 0.98,
} as const;

export type TypeScale = typeof TYPE_SCALE;

/** Every carousel shares the same scale. Kept as a function so callers stay unchanged. */
export function deckTypeScale(slides: CarouselSlide[]): TypeScale {
  void slides;
  return TYPE_SCALE;
}

export function aiPrompt(config: CarouselConfig) {
  return `Create a minimal LinkedIn carousel from the source text below. Return JSON only, with no markdown fences.

Rules:
- 5 to 8 slides. One idea per slide.
- Titles: 10 words or fewer. Plain, concrete language. Sentence case, never capitals. No colons, no hype.
- Put a "|" in a title to force a line break where the sense breaks. Use it on the cover and on any title of five words or more.
- Bodies: 45 words or fewer. Separate paragraphs with a blank line. The cover body is its subtitle: one short line.
- Wrap one word in *asterisks* for italic. Do this on the cover and on at most two other slides. Wrap one short phrase in **double asterisks** for a highlighter stroke, on one slide at most.
- Layouts: "cover" first, "closing" last. "content" is a headline with copy and does most of the work.
- "poster" is one short serif statement, eight words or fewer. Title only. Use it for the strongest line, no more than twice.
- "note" is one plain sans statement of two or three lines, for an aside or a turn in the story. Title only. Wrap the phrase that matters in **double asterisks** for bold. Use it up to twice.
- "photos" holds photographs the author adds later, under a one-line title. Title only. Use it only when the source describes pictures.
- "diagram" draws an inline SVG as a centred figure with the title as its one-line caption. Title only. Use it for architecture, flows and comparisons: one per deck, two at most. Put the SVG in "diagram". Rules for the drawing: viewBox="0 0 800 500", no width or height attributes, stroke="currentColor" and fill="none" for shapes, fill="currentColor" for text, stroke-width 2, rx 8 on boxes, font-family="Helvetica Neue, Helvetica, Arial, sans-serif", labels 24px and notes 18px, nothing smaller, at most six boxes, arrows drawn with a line plus a small polygon head, generous space, no colour, no gradients, no scripts.
- "tone" is optional. Put "sage" on one poster at most; otherwise omit it for paper. Every text element on a page uses the same ink colour.
- "mark" is the series label at the top of every slide. Keep it short and in sentence case.

Use this exact shape:
${JSON.stringify(
    {
      version: 1,
      title: "Carousel title",
      author: config.author,
      mark: config.mark ?? BRAND_MARK,
      slides: [
        {
          layout: "cover | content | note | poster | diagram | photos | closing",
          tone: "paper | sage | black",
          title: "Slide headline",
          body: "Optional supporting copy",
          diagram: "<svg viewBox=\"0 0 800 500\">…</svg> (diagram slides only)",
        },
      ],
    },
    null,
    2,
  )}

SOURCE TEXT:
`;
}
