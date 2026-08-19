"use client";

import { CSSProperties } from "react";
import {
  bodyParagraphs,
  CarouselConfig,
  CarouselSlide,
  deckTypeScale,
  parseInlineMarks,
  slideAlign,
  slidePosition,
  slideTemplate,
  titleLines,
} from "./carousel";
import { scrimGradient } from "./scrim";

export type TypeScale = ReturnType<typeof deckTypeScale>;

function Marked({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarks(text).map((run, index) =>
        run.mark === "plain"
          ? run.text
          : <span className={`mark-${run.mark}`} key={index}>{run.text}</span>,
      )}
    </>
  );
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
  const position = slidePosition(slide);
  const lines = titleLines(slide.title);

  // Only real bytes are painted. An `img:` key that survived to here is an image
  // saved in another browser: it stays in the config so saving cannot lose it, but
  // there is nothing to draw, and url(img:…) would just be a failed fetch per slide.
  const painted = slide.background?.startsWith("data:") ? slide.background : undefined;

  const style = {
    "--title-size": `${isCover ? scale.cover : scale.title}cqw`,
    "--title-tracking": `${isCover ? scale.coverTracking : scale.tracking}em`,
    "--title-leading": `${isCover ? scale.coverLeading : scale.leading}`,
    "--body-size": `${scale.body}cqw`,
    "--slide-scrim": scrimGradient(slide.layout, position, slide.luma),
    ...(painted ? { "--slide-background": `url(${painted})` } : {}),
  } as CSSProperties;

  // A headline opening on a quote mark sits visibly indented against the copy below
  // it unless the mark is hung into the margin. CSS hanging-punctuation is Safari
  // only, so the indent is set by hand, and only where there is a margin to hang into.
  const hangs = /^["“”'‘’]/.test(lines[0]) && slideAlign(slide) === "left";

  return (
    <article
      className={`carousel-slide template-${slideTemplate(slide, config)} layout-${slide.layout} pos-${position} align-${slideAlign(slide)} ${exportMode ? "export-slide" : ""}`}
      style={style}
      data-export-slide={exportMode ? "true" : undefined}
    >
      <div className="slide-image" />
      <div className="slide-overlay" />
      <div className="slide-content">
        <h2 className={`${lines.length > 1 ? "title-broken" : ""} ${hangs ? "title-hang" : ""}`}>
          {lines.map((line, lineIndex) => (
            <span className="title-line" key={lineIndex}><Marked text={line} /></span>
          ))}
        </h2>
        {bodyParagraphs(slide.body).map((paragraph, paragraphIndex) => (
          <p key={paragraphIndex}><Marked text={paragraph} /></p>
        ))}
      </div>
      <footer className="slide-meta">
        <span>{config.author}</span>
        <span>{String(index + 1).padStart(2, "0")} / {String(config.slides.length).padStart(2, "0")}</span>
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
