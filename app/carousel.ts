export type TemplateId = "editorial" | "signal";
export type SlideLayout = "cover" | "content" | "quote" | "closing";

export type CarouselSlide = {
  id: string;
  layout: SlideLayout;
  kicker: string;
  title: string;
  body: string;
  background?: string;
};

export type CarouselConfig = {
  version: 1;
  title: string;
  author: string;
  template: TemplateId;
  slides: CarouselSlide[];
};

export const starterConfig: CarouselConfig = {
  version: 1,
  title: "Directing AI",
  author: "OWAIN LEWIS",
  template: "editorial",
  slides: [
    {
      id: "starter-cover",
      layout: "cover",
      kicker: "A practical field guide",
      title: "AI won’t replace developers.",
      body: "But developers who know how to direct it will move much faster.",
    },
    {
      id: "starter-context",
      layout: "content",
      kicker: "The shift",
      title: "The bottleneck is changing",
      body: "Writing code is becoming cheaper. Deciding what to build, giving clear context, and judging the result are becoming more valuable.",
    },
    {
      id: "starter-method",
      layout: "content",
      kicker: "A better loop",
      title: "Direct. Inspect. Refine.",
      body: "Give the model one concrete outcome. Review the work against evidence. Tighten the brief, then run the loop again.",
    },
    {
      id: "starter-close",
      layout: "closing",
      kicker: "Start here",
      title: "Treat context as part of the craft.",
      body: "Save this for your next build.",
    },
  ],
};

const layouts: SlideLayout[] = ["cover", "content", "quote", "closing"];
const templates: TemplateId[] = ["editorial", "signal"];

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
    : "editorial";

  const slides = record.slides.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Slide ${index + 1} must be an object.`);
    }
    const slide = item as Record<string, unknown>;
    const title = limitedText(slide.title, `Slide ${index + 1} title`, 90);
    if (!title) throw new Error(`Slide ${index + 1} needs a title.`);

    const background = cleanText(slide.background);
    if (background && !background.startsWith("data:image/")) {
      throw new Error(`Slide ${index + 1} has an unsupported background.`);
    }

    return {
      id: cleanText(slide.id, makeId(index)),
      layout: layouts.includes(slide.layout as SlideLayout)
        ? (slide.layout as SlideLayout)
        : index === 0
          ? "cover"
          : "content",
      kicker: limitedText(slide.kicker, `Slide ${index + 1} kicker`, 50),
      title,
      body: limitedText(slide.body, `Slide ${index + 1} body`, 280),
      ...(background ? { background } : {}),
    } satisfies CarouselSlide;
  });

  return {
    version: 1,
    title: limitedText(record.title, "Carousel title", 100, "Untitled carousel"),
    author: limitedText(record.author, "Author", 40, "YOUR NAME").toUpperCase(),
    template,
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
    author: "YOUR NAME",
    template: "editorial",
  },
): CarouselConfig {
  const chunks = sentenceChunks(source).slice(0, 10);
  if (!chunks.length) throw new Error("Paste some source text first.");

  const parsed = chunks.map(splitHeading);
  const slides: CarouselSlide[] = parsed.map((chunk, index) => ({
    id: makeId(index),
    layout: index === 0 ? "cover" : "content",
    kicker: index === 0 ? "A quick guide" : `Idea ${index}`,
    title: chunk.title,
    body: chunk.body,
  }));

  if (slides.length > 1) {
    slides[slides.length - 1] = {
      ...slides[slides.length - 1],
      layout: "closing",
      kicker: "One last thought",
    };
  }

  return {
    version: 1,
    title: slides[0].title.replace(/[.!?]$/, ""),
    author: options.author.trim().toUpperCase() || "YOUR NAME",
    template: options.template,
    slides,
  };
}

export function aiPrompt(config: CarouselConfig) {
  return `Create a concise LinkedIn carousel from the source text below. Return JSON only, with no markdown fences. Keep each slide readable at a glance. Use 5–8 slides, no more than 18 words in a title, and no more than 45 words in a body.\n\nUse this exact shape:\n${JSON.stringify(
    {
      version: 1,
      title: "Carousel title",
      author: config.author,
      template: config.template,
      slides: [
        {
          layout: "cover | content | quote | closing",
          kicker: "Short label",
          title: "Slide headline",
          body: "Optional supporting copy",
        },
      ],
    },
    null,
    2,
  )}\n\nSOURCE TEXT:\n`;
}
