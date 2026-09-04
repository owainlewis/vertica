"use client";

import { CSSProperties } from "react";
import {
  bodyParagraphs,
  CarouselConfig,
  CarouselSlide,
  imageCapacity,
  parseInlineMarks,
  photoArrangement,
  showsBody,
  sanitizeSvg,
  slideAlign,
  slidePosition,
  smartQuotes,
  titleLines,
  TypeScale,
  usesImages,
} from "./carousel";
import { scrimGradient } from "./scrim";

export type { TypeScale } from "./carousel";

function Marked({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarks(smartQuotes(text)).map((run, index) =>
        run.mark === "plain"
          ? run.text
          : <span className={`mark-${run.mark}`} key={index}>{run.text}</span>,
      )}
    </>
  );
}

/** Only real bytes are painted. A stored key that reached the renderer has nothing to draw. */
function painted(ref: string | undefined) {
  return ref?.startsWith("data:") ? ref : undefined;
}

export function Slide({
  slide,
  config,
  scale,
  index,
  exportMode = false,
}: {
  slide: CarouselSlide;
  config: CarouselConfig;
  scale: TypeScale;
  index: number;
  exportMode?: boolean;
}) {
  const isCover = slide.layout === "cover";
  const isPoster = slide.layout === "poster";
  const position = slidePosition(slide);
  const lines = titleLines(slide.title);
  // Title-only layouts keep their body in the document but never draw it.
  const paragraphs = showsBody(slide.layout) ? bodyParagraphs(slide.body) : [];
  const background = painted(slide.background);
  const avatar = painted(config.avatar);
  const pictures = usesImages(slide.layout)
    ? (slide.images ?? []).slice(0, imageCapacity(slide.layout)).map(painted)
    : [];
  const diagram = slide.layout === "diagram" && slide.diagram ? sanitizeSvg(slide.diagram) : "";
  const isLast = index === config.slides.length - 1;
  const showArrow = config.arrow !== false && !isLast;

  const style = {
    "--title-size": `${isCover ? scale.cover : isPoster ? scale.poster : scale.title}cqw`,
    "--title-tracking": `${scale.tracking}em`,
    "--title-leading": `${scale.leading}`,
    "--body-size": `${scale.body}cqw`,
    "--slide-scrim": scrimGradient(slide.layout, position, slide.luma),
    ...(background ? { "--slide-background": `url(${background})` } : {}),
  } as CSSProperties;

  // A headline opening on a quote mark sits visibly indented against the copy below
  // it unless the mark is hung into the margin. CSS hanging-punctuation is Safari
  // only, so the indent is set by hand, and only where there is a margin to hang into.
  const hangs = /^["“”'‘’]/.test(smartQuotes(lines[0])) && slideAlign(slide) === "left";

  const copy = (
    <>
      <h2 className={`${lines.length > 1 ? "title-broken" : ""} ${hangs ? "title-hang" : ""}`}>
        {lines.map((line, lineIndex) => (
          <span className="title-line" key={lineIndex}><Marked text={line} /></span>
        ))}
      </h2>
      {paragraphs.map((paragraph, paragraphIndex) => (
        <p key={paragraphIndex}><Marked text={paragraph} /></p>
      ))}
    </>
  );

  const page = String(index + 1).padStart(2, "0");
  const counter = config.numbering === "fraction"
    ? `${page} / ${String(config.slides.length).padStart(2, "0")}`
    : page;

  const classes = [
    "carousel-slide",
    "template-editorial",
    `layout-${slide.layout}`,
    `pos-${position}`,
    `align-${slideAlign(slide)}`,
    slide.tone ? `tone-${slide.tone}` : "tone-paper",
    background ? "has-background" : "",
    slide.plate ? "has-plate" : "",
    config.mark ? "has-mark" : "",
    avatar ? "has-avatar" : "",
    pictures.length ? `has-pictures pictures-${pictures.length} photos-${photoArrangement(pictures.length)}` : "",
    diagram ? "has-diagram" : "",
    // A one-word poster ("But…") is a beat, not a sentence, and gets set larger.
    isPoster && slide.title.replace(/[*|]/g, "").trim().length <= 10 ? "title-short" : "",
    exportMode ? "export-slide" : "",
  ].filter(Boolean).join(" ");

  return (
    <article className={classes} style={style} data-export-slide={exportMode ? "true" : undefined}>
      <div className="slide-image" />
      <div className="slide-overlay" />
      <div className="slide-rules" />
      <header className="slide-head">
        {config.mark && <span className="slide-mark">{config.mark}</span>}
        <span className="slide-counter">{counter}</span>
      </header>
      <div className="slide-content">
        {/* Only wrapped when there is a plate to draw, so every other slide keeps
            the exact box it had before and its line breaking cannot shift. */}
        {slide.plate ? <div className="slide-plate">{copy}</div> : copy}
      </div>
      {/* Sanitised at parse time and again here, so a diagram can draw but never run. */}
      {slide.layout === "diagram" && (
        <div className="slide-diagram">
          {diagram
            ? <div className="slide-diagram-svg" dangerouslySetInnerHTML={{ __html: diagram }} />
            : <div className="slide-diagram-empty">Add an SVG diagram under Content</div>}
        </div>
      )}
      {pictures.length > 0 && (
        <div className="slide-pictures">
          {pictures.map((picture, pictureIndex) => (
            <div
              className={`slide-picture ${picture ? "" : "is-missing"}`}
              key={pictureIndex}
              style={picture ? { backgroundImage: `url(${picture})` } : undefined}
            />
          ))}
        </div>
      )}
      <footer className="slide-meta">
        <span className="meta-identity">
          {avatar && <span className="slide-avatar" style={{ backgroundImage: `url(${avatar})` }} />}
          <span className="meta-author">{config.author}</span>
        </span>
        {showArrow && <span className="slide-arrow" aria-hidden="true">→</span>}
      </footer>
    </article>
  );
}

/** Offscreen full-size slides. The PDF export reads these, never the preview. */
export function ExportStage({ config, scale }: { config: CarouselConfig; scale: TypeScale }) {
  return (
    <div className="export-stage" aria-hidden="true">
      {config.slides.map((slide, index) => (
        <Slide key={slide.id} slide={slide} config={config} scale={scale} index={index} exportMode />
      ))}
    </div>
  );
}
