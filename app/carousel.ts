import { isSupportedImageDataUrl } from "./image-formats.ts";
import { parseVideoBackground, type VideoBackground } from "./video-formats.ts";

/** Four authoring layouts; older documents are mapped without dropping their content. */
export type SlideLayout = "cover" | "content" | "note" | "closing";
export type SlideVisual = "photos" | "diagram";

export type EditorialTone = "paper" | "sage" | "black";
export type CarouselTheme = "editorial" | "ai-engineer";

/** Unknown themes use the original artwork, including documents written before themes. */
export function carouselTheme(value: unknown): CarouselTheme {
  return value === "ai-engineer" ? "ai-engineer" : "editorial";
}

/** Stored tones stay intact when switching themes. Only an unset tone is automatic. */
export function slideTone(slide: CarouselSlide, theme?: CarouselTheme): EditorialTone {
  // Older AI Engineer decks used the sage slot for sand. Keep the stored choice
  // for Editorial, but render it as the same soft grey as other light slides.
  if (theme === "ai-engineer" && slide.tone === "sage") return "paper";
  if (slide.tone) return slide.tone;
  return theme === "ai-engineer" && slide.layout === "cover" ? "black" : "paper";
}
/** Where the text block sits in the frame, independent of colour. */
export type SlidePosition = "top" | "middle" | "bottom";
export type SlideAlign = "left" | "center";

export type CarouselSlide = {
  id: string;
  layout: SlideLayout;
  /** Body 2 can hold a statement, photographs, or an SVG example. */
  visual?: SlideVisual;
  title: string;
  body: string;
  background?: string;
  video?: VideoBackground;
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
   * How strongly the background photograph is veiled under the copy, 0 to 1.
   * Absent means the default. 0 shows the photograph untouched.
   */
  veil?: number;
  /** Both default from the slide type, so decks written before these existed are unchanged. */
  position?: SlidePosition;
  align?: SlideAlign;
  /** Header and footer are visible unless explicitly hidden on this slide. */
  showHeader?: boolean;
  showFooter?: boolean;
  /** An optional editorial ground. */
  tone?: EditorialTone;
};

/** Body 2 is the only layout that paints an inline visual. */
export function usesImages(slide: Pick<CarouselSlide, "layout" | "visual">) {
  const resolved = normalizeSlideLayout(slide);
  return resolved.layout === "note" && resolved.visual === "photos";
}

export function imageCapacity(slide: Pick<CarouselSlide, "layout" | "visual">) {
  return usesImages(slide) ? 9 : 0;
}

export function photoArrangement(count: number): "figure" | "strip" | "grid" {
  return count <= 1 ? "figure" : count <= 3 ? "strip" : "grid";
}

/** Body 2 retains supporting copy so switching layouts never loses it. */
export function showsBody(layout: SlideLayout) {
  return layout === "cover" || layout === "content" || layout === "closing";
}

const LEGACY_LAYOUTS: Record<string, SlideLayout> = {
  quote: "content", split: "content", poster: "note",
  diagram: "note", photos: "note", grid: "note", strip: "note", figure: "note",
};

export function normalizeLayout(value: unknown, fallback: SlideLayout): SlideLayout {
  if (typeof value !== "string") return fallback;
  return layouts.includes(value as SlideLayout) ? value as SlideLayout : LEGACY_LAYOUTS[value] ?? fallback;
}

function normalizeVisual(value: unknown, oldLayout: unknown): SlideVisual | undefined {
  if (oldLayout === "diagram") return "diagram";
  if (["photos", "grid", "strip", "figure"].includes(String(oldLayout))) return "photos";
  return value === "photos" || value === "diagram" ? value : undefined;
}

/** Used for stored decks and gallery covers as well as validated JSON imports. */
export function normalizeSlideLayout<T extends Pick<CarouselSlide, "layout" | "visual">>(slide: T, fallback: SlideLayout = "content"): T {
  const layout = normalizeLayout(slide.layout, fallback);
  const visual = normalizeVisual(slide.visual, slide.layout);
  return { ...slide, layout, visual };
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
  if (usesImages(slide)) return "top";
  // A diagram's headline reads as a caption under the figure, like a plate in a book.
  if (normalizeSlideLayout(slide).visual === "diagram" && normalizeLayout(slide.layout, "content") === "note") return "bottom";
  return "middle";
}

export function slideAlign(slide: CarouselSlide, theme?: CarouselTheme): SlideAlign {
  if (slide.align) return slide.align;
  if (theme === "ai-engineer") return "left";
  return normalizeLayout(slide.layout, "content") === "content" || normalizeLayout(slide.layout, "content") === "note" ? "left" : "center";
}

export type CarouselConfig = {
  version: 1;
  title: string;
  author: string;
  /** Omitted on older decks, which keep the Editorial theme. */
  theme?: CarouselTheme;
  /**
   * A short series label set at the top of every slide. This is what makes a deck
   * recognisable mid-scroll: same words, same place, every slide. Deck-level on
   * purpose, so it is set once rather than retyped per slide.
   */
  mark?: string;
  /** A swipe arrow bottom-right on every slide but the last. Defaults on. */
  arrow?: boolean;
  slides: CarouselSlide[];
};

/** Every image reference a slide can carry, whether painted or not. */
export function slideImageRefs(slide: CarouselSlide) {
  return [slide.background, ...(slide.images ?? [])].filter((value): value is string => Boolean(value));
}

/** Stops an export that would silently paint an unresolved local image as blank. */
export function assertBackgroundsAvailableForExport(config: CarouselConfig) {
  const missing = config.slides
    .map((slide, index) => (slideImageRefs(slide).some((ref) => ref.startsWith("img:")) ? index + 1 : null))
    .filter((index): index is number => index !== null);

  if (!missing.length) return;
  const slides = missing.length === 1 ? `slide ${missing[0]} are` : `slides ${missing.join(", ")} are`;
  throw new Error(
    `Images for ${slides} not available in this browser. Open this carousel where the images were uploaded, or replace them before exporting.`,
  );
}

/** The offer every deck promotes. The mark is the series, the footer is where to go. */
export const BRAND_MARK = "AI Engineer";
export const BRAND_FOOTER = "aiengineer.co";

const layouts: SlideLayout[] = ["cover", "content", "note", "closing"];
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
    const video = slide.video === undefined ? undefined : parseVideoBackground(slide.video);
    if (video && background) throw new Error(`Slide ${index + 1} needs either a photo or a video background.`);

    const images = Array.isArray(slide.images)
      ? slide.images.map((entry) => cleanText(entry)).filter(Boolean)
      : [];
    if (images.some((entry) => !isImageRef(entry))) {
      throw new Error(`Slide ${index + 1} has an unsupported image.`);
    }
    if (images.length > MAX_IMAGES) {
      throw new Error(`Slide ${index + 1} has more than ${MAX_IMAGES} images.`);
    }
    const veil = typeof slide.veil === "number" && Number.isFinite(slide.veil) ? clamp(slide.veil, 0, 1) : undefined;

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
      ...(normalizeVisual(slide.visual, slide.layout) ? { visual: normalizeVisual(slide.visual, slide.layout) } : {}),
      title,
      body: limitedText(slide.body, `Slide ${index + 1} body`, 280),
      ...(background ? { background } : {}),
      ...(video ? { video } : {}),
      ...(images.length ? { images } : {}),
      ...(diagram ? { diagram } : {}),
      ...(veil !== undefined ? { veil } : {}),
      ...(slide.showHeader === false ? { showHeader: false } : {}),
      ...(slide.showFooter === false ? { showFooter: false } : {}),
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

  return {
    version: 1,
    title: limitedText(record.title, "Carousel title", 100, "Untitled carousel"),
    author: limitedText(record.author, "Author", 40) || BRAND_FOOTER,
    mark,
    ...(record.theme !== undefined ? { theme: carouselTheme(record.theme) } : {}),
    ...(record.arrow === false ? { arrow: false } : {}),
    slides,
  };
}

/** Elements a diagram may use. Anything else is dropped with everything inside it. */
const SVG_ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "title", "desc", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "text", "tspan", "textpath", "a", "marker", "pattern", "clippath",
  "mask", "lineargradient", "radialgradient", "stop", "switch", "filter", "feblend",
  "fecolormatrix", "fecomponenttransfer", "fecomposite", "feconvolvematrix", "fediffuselighting",
  "fedisplacementmap", "fedistantlight", "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg",
  "fefuncr", "fegaussianblur", "femerge", "femergenode", "femorphology", "feoffset", "fepointlight",
  "fespecularlighting", "fespotlight", "fetile", "feturbulence",
]);
/** Attributes that can carry a reference out of the document. Only local `#` targets survive. */
const SVG_LINK_ATTRIBUTES = new Set(["href", "xlink:href", "src"]);

// Only drawing properties may enter CSS. Layout, selectors, custom properties,
// and resource-loading functions have no place in a diagram's inline styles.
const SVG_PRESENTATION_ATTRIBUTES = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset",
  "stroke-opacity", "opacity", "color", "stop-color", "stop-opacity", "flood-color",
  "flood-opacity", "lighting-color", "font-family", "font-size", "font-weight",
  "font-style", "font-stretch", "font-variant", "letter-spacing", "word-spacing",
  "text-anchor", "dominant-baseline", "alignment-baseline", "baseline-shift",
  "text-decoration", "vector-effect", "paint-order", "shape-rendering", "text-rendering",
  "color-interpolation", "color-interpolation-filters", "clip-rule", "clip-path", "mask",
  "filter", "marker-start", "marker-mid", "marker-end",
]);
const SVG_ATTRIBUTES = new Set([
  "id", "class", "xmlns", "xmlns:xlink", "viewbox", "preserveaspectratio", "transform",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height",
  "d", "points", "pathlength", "dx", "dy", "rotate", "textlength", "lengthadjust",
  "startoffset", "method", "spacing", "markerwidth", "markerheight", "markerunits",
  "refx", "refy", "orient", "patternunits", "patterncontentunits", "patterntransform",
  "clippathunits", "maskunits", "maskcontentunits", "gradientunits", "gradienttransform",
  "spreadmethod", "fx", "fy", "fr", "offset", "filterunits", "primitiveunits", "in", "in2",
  "result", "mode", "type", "values", "operator", "k1", "k2", "k3", "k4", "order",
  "kernelmatrix", "divisor", "bias", "targetx", "targety", "edgemode", "kernelunitlength",
  "preservealpha", "surfacescale", "diffuseconstant", "specularconstant", "specularexponent",
  "scale", "xchannelselector", "ychannelselector", "azimuth", "elevation", "stddeviation",
  "tablevalues", "slope", "intercept", "amplitude", "exponent", "z", "pointsatx", "pointsaty",
  "pointsatz", "limitingconeangle", "basefrequency", "numoctaves", "seed", "stitchtiles",
]);

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeEntities(value: string) {
  return value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (whole, hex: string, dec: string, name: string) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()];
    const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function encodeText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function encodeAttribute(value: string) {
  return encodeText(value).replace(/"/g, "&quot;");
}

/** Plain values, numeric colours, or one local paint/filter reference. No CSS indirection. */
function safePresentationValue(value: string) {
  return /^(?:[\w\s#.,%+'"/-]+|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+/-]+\)|url\(\s*(['"]?)#[\w:.-]+\1\s*\))$/i.test(value);
}

/** Keep a small set of inline drawing declarations; stylesheet elements are dropped. */
function sanitizeCss(css: string) {
  return css.split(";").flatMap((declaration) => {
    const colon = declaration.indexOf(":");
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    return colon > 0 && SVG_PRESENTATION_ATTRIBUTES.has(property) && safePresentationValue(value)
      ? [`${property}:${value}`]
      : [];
  }).join(";");
}

type SvgAttribute = { name: string; value: string };

/**
 * Reads one start tag the way an HTML parser would: attributes are separated by
 * whitespace or by `/`, values may be quoted or bare. Rebuilding the tag from this
 * list is what keeps `<a/onclick=…>` from sneaking past a whitespace-only check.
 */
function readTag(source: string, from: number) {
  const open = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(source.slice(from));
  if (!open) return null;
  const closing = open[1] === "/";
  const name = open[2].toLowerCase();
  const attributes: SvgAttribute[] = [];
  let index = from + open[0].length;
  let selfClosing = false;

  while (index < source.length) {
    const char = source[index];
    if (char === ">") return { name, closing, attributes, selfClosing, end: index + 1 };
    if (/[\s/]/.test(char)) {
      selfClosing = char === "/";
      index += 1;
      continue;
    }
    selfClosing = false;
    const attr = /^([^\s"'=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/.exec(source.slice(index));
    if (!attr) { index += 1; continue; }
    attributes.push({ name: attr[1], value: decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? "") });
    index += attr[0].length;
  }
  return null;
}

function cleanAttribute({ name, value }: SvgAttribute, isRoot: boolean): SvgAttribute | null {
  // Case is kept (viewBox, clipPathRule) but never trusted for the checks.
  const key = name.toLowerCase();
  if (key.startsWith("on")) return null;
  // The slide sizes the drawing, so a fixed width or height on the root only fights it.
  if (isRoot && (key === "width" || key === "height")) return null;
  if (SVG_LINK_ATTRIBUTES.has(key)) return /^#[\w:.-]+$/.test(value.trim()) ? { name, value: value.trim() } : null;
  if (key === "style") {
    const clean = sanitizeCss(value);
    return clean ? { name, value: clean } : null;
  }
  if (SVG_PRESENTATION_ATTRIBUTES.has(key)) return safePresentationValue(value.trim()) ? { name, value: value.trim() } : null;
  return SVG_ATTRIBUTES.has(key) ? { name, value } : null;
}

/**
 * Keeps an SVG drawable and nothing else. Scripts, event handlers, embedded HTML
 * and any reference that would leave the document are removed, so a pasted diagram
 * can draw but cannot run or fetch. Returns "" for anything that is not an <svg>.
 *
 * A small scanner rather than a DOM parser because this also runs where there is no
 * DOM. Every tag is rebuilt from its parsed attributes, so what is emitted is only
 * what was explicitly allowed, however the input was spelled.
 */
export function sanitizeSvg(input: string) {
  const trimmed = input.trim();
  if (!/^<svg[\s>]/i.test(trimmed) || !/<\/svg>\s*$/i.test(trimmed)) return "";
  const source = trimmed
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<![\s\S]*?>/g, "");

  let out = "";
  let index = 0;
  // Elements being dropped, with everything inside them, are counted rather than emitted.
  let dropDepth = 0;
  let root = true;

  while (index < source.length) {
    const next = source.indexOf("<", index);
    if (next === -1 || next > index) {
      const text = source.slice(index, next === -1 ? source.length : next);
      if (!dropDepth) out += encodeText(decodeEntities(text));
      if (next === -1) break;
      index = next;
    }
    const tag = readTag(source, index);
    if (!tag) {
      if (!dropDepth) out += "&lt;";
      index += 1;
      continue;
    }
    index = tag.end;
    if (tag.closing) {
      if (dropDepth) { dropDepth -= 1; continue; }
      if (!SVG_ELEMENTS.has(tag.name)) continue;
      out += `</${tag.name}>`;
      continue;
    }
    if (dropDepth || !SVG_ELEMENTS.has(tag.name) || (tag.name === "svg" && !root)) {
      if (!tag.selfClosing) dropDepth += 1;
      continue;
    }
    const attributes = tag.attributes
      .map((attribute) => cleanAttribute(attribute, root && tag.name === "svg"))
      .filter((attribute): attribute is SvgAttribute => attribute !== null)
      .map(({ name, value }) => ` ${name}="${encodeAttribute(value)}"`)
      .join("");
    root = false;
    out += `<${tag.name}${attributes}${tag.selfClosing ? "/" : ""}>`;
  }
  return out;
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

/** A short, complete statement with nothing under it is a Body 2 statement. */
const STATEMENT_MAX_WORDS = 8;

/**
 * Builds the rhythm the reference decks have from plain paragraphs: a cover with a
 * subtitle, content slides that explain, a short statement set as Body 2 now and
 * then, one of them on a sage ground, and a close.
 */
export function generateCarouselFromText(source: string, author = BRAND_FOOTER, theme?: CarouselTheme): CarouselConfig {
  const chunks = sentenceChunks(source);
  if (!chunks.length) throw new Error("Paste some source text first.");
  if (chunks.length > 10) {
    throw new Error(`This text needs ${chunks.length} slides. Shorten it or split it into separate carousels (10 slides maximum).`);
  }

  const parsed = chunks.map(splitHeading);
  const last = parsed.length - 1;
  let sageUsed = false;

  const slides: CarouselSlide[] = parsed.map((chunk, index) => {
    const title = chunk.title;
    if (index === 0) return { id: makeId(index), layout: "cover", title: suggestBreak(title), body: chunk.body };
    if (index === last && parsed.length > 1) return { id: makeId(index), layout: "closing", title: suggestBreak(title), body: chunk.body };

    const statement = !chunk.body && wordCount(chunk.title) <= STATEMENT_MAX_WORDS;
    if (!statement) return { id: makeId(index), layout: "content", title, body: chunk.body };

    // The first big statement after the setup gets the colour, and only that one, so
    // the sage slide stays an event rather than a pattern.
    const tone = theme !== "ai-engineer" && !sageUsed && index >= 2 ? "sage" : undefined;
    if (tone) sageUsed = true;
    return { id: makeId(index), layout: "note", title, body: "", ...(tone ? { tone } : {}) };
  });

  return {
    version: 1,
    title: titleLines(slides[0].title).join(" ").replace(/[.!?]$/, ""),
    author: author.trim() || BRAND_FOOTER,
    mark: BRAND_MARK,
    ...(theme ? { theme } : {}),
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
 * Shared reading sizes keep both themes legible at phone width. Display sizes
 * account for Signifier's lighter shapes and Geist's heavier weight. Container
 * width units keep previews and exports the same drawing at different sizes.
 */
export const TYPE_SCALE = {
  cover: 12.8,
  cta: 8,
  body: (18 / 390) * 100, // 18px at a 390px feed width, in container-width units.
  statement: 6,
  metadata: 2.7,
  tracking: -0.02,
  leading: 1.06,
} as const;

export const AI_ENGINEER_TYPE_SCALE = {
  ...TYPE_SCALE,
  cover: 10.6,
  tracking: -0.025,
} as const;

export function aiPrompt(config: CarouselConfig) {
  const branded = config.theme === "ai-engineer";
  return `Create a minimal LinkedIn carousel from the source text below. Return JSON only, with no markdown fences.

Rules:
- 5 to 8 slides. One idea per slide.
- Titles: 10 words or fewer. Plain, concrete language. Sentence case, never capitals. No colons, no hype.
- Use "|" sparingly for deliberate breaks in a cover or CTA. Let Body 1 leads wrap naturally.
- Bodies: 45 words or fewer. Separate paragraphs with a blank line. The cover body is its subtitle: one short line.
- Wrap one word in *asterisks* for italic. Do this on the cover and on at most two other slides. Wrap one short phrase in **double asterisks** for ${branded ? "bold accent text" : "a highlighter stroke"}, on one slide at most.
- Four layouts: "cover" (Cover), "content" (Body 1), "note" (Body 2), "closing" (CTA). Start with a cover and finish with one useful action.
- Body 1 is a bold lead followed by short paragraphs, all at a readable text size. Use it for most teaching slides. No introduction or agenda slide: begin delivering the cover's promise on slide two.
- Body 2 holds one short statement or a visual example with its title as the caption. It draws the title only; omit body. Use it when the idea benefits, not to meet a layout quota.
- For pictures on Body 2, set "visual": "photos" and add image references to "images". For an SVG, set "visual": "diagram" and put the drawing in "diagram". Images and diagrams are optional.
- SVG rules: viewBox="0 0 800 500", no width or height attributes, stroke="currentColor" and fill="none" for shapes, fill="currentColor" for text, stroke-width 2, rx 8 on boxes, font-family="${branded ? "inherit" : "Helvetica Neue, Helvetica, Arial, sans-serif"}", labels 44px and notes 40px, nothing smaller, at most six boxes, arrows drawn with a line plus a small polygon head, generous space, no colour, no gradients, no scripts.
- ${branded ? 'The theme is "ai-engineer": Geist type, a forest cover and soft-grey slides. Keep body copy to 30 words or fewer. Omit "tone" for an automatic forest cover and soft grey on every other layout. Explicit tones: "paper" is soft grey and "black" is forest. Do not use "sage" in this theme. Italic and bold phrases use a contrasting accent.' : '"tone" is optional. Use "sage" sparingly on Body 2; otherwise omit it for paper. Every text element on a page uses the same ink colour.'}
- "mark" is the series label at the top of every slide. Keep it short and in sentence case.
- Per slide, "showHeader": false hides the series label and page number; "showFooter": false hides the author and swipe arrow. Both default to visible. Set both to false for main text only.

Use this exact shape:
${JSON.stringify(
    {
      version: 1,
      title: "Carousel title",
      author: config.author,
      mark: config.mark ?? BRAND_MARK,
      theme: carouselTheme(config.theme),
      slides: [
        {
          layout: "cover | content | note | closing",
          visual: "photos | diagram (optional, Body 2 only)",
          tone: branded ? "paper | black" : "paper | sage | black",
          title: "Slide headline",
          body: "Optional supporting copy",
          showHeader: true,
          showFooter: true,
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

/** A reusable deck gets independent slide IDs while durable image references stay shared. */
export function duplicateCarouselConfig(config: CarouselConfig): CarouselConfig {
  const copy = structuredClone(config);
  copy.title = `${config.title.slice(0, 93)} (copy)`;
  copy.slides = copy.slides.map((slide) => ({ ...slide, id: `slide-${crypto.randomUUID()}` }));
  return copy;
}
