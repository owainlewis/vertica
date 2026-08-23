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
  isLegacyTypeOnlyTemplate,
  smartQuotes,
  titleLines,
} from "./carousel";
import { scrimGradient } from "./scrim";

export type TypeScale = ReturnType<typeof deckTypeScale>;

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
  const paragraphs = bodyParagraphs(slide.body);
  const rawTemplate = slide.template ?? (config.template as unknown);
  const legacyTypeOnly = isLegacyTypeOnlyTemplate(rawTemplate);

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
  const hangs = /^["“”'‘’]/.test(smartQuotes(lines[0])) && slideAlign(slide) === "left";

  const copy = (
    <>
      <h2 className={`${lines.length > 1 ? "title-broken" : ""} ${hangs ? "title-hang" : ""}`}>
        {lines.map((line, lineIndex) => (
          <span className="title-line" key={lineIndex}><Marked text={line} /></span>
        ))}
      </h2>
      {slide.layout === "quote" && paragraphs.length ? (
        <div className="slide-callout">
          {paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex}><Marked text={paragraph} /></p>
          ))}
        </div>
      ) : paragraphs.map((paragraph, paragraphIndex) => (
        <p key={paragraphIndex}><Marked text={paragraph} /></p>
      ))}
    </>
  );

  const classes = [
    "carousel-slide",
    `template-${slideTemplate(slide, config)}`,
    `layout-${slide.layout}`,
    `pos-${position}`,
    `align-${slideAlign(slide)}`,
    legacyTypeOnly ? "legacy-type-only" : "",
    painted ? "has-background" : "",
    slide.plate ? "has-plate" : "",
    config.mark ? "has-mark" : "",
    exportMode ? "export-slide" : "",
  ].filter(Boolean).join(" ");

  return (
    <article className={classes} style={style} data-export-slide={exportMode ? "true" : undefined}>
      <div className="slide-image" />
      <div className="slide-overlay" />
      {config.mark && <div className="slide-mark">{config.mark}</div>}
      <div className="slide-content">
        {/* Only wrapped when there is a plate to draw, so every other slide keeps
            the exact box it had before and its line breaking cannot shift. */}
        {slide.plate ? <div className="slide-plate">{copy}</div> : copy}
      </div>
      <footer className="slide-meta">
        <span className="meta-author">{config.author}</span>
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
