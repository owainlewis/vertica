import type { CSSProperties } from "react";
import VideoBackground from "./video-background";
import { HORIZONTAL_VIDEO_FRAME, videoUrl } from "./video-formats";
import {
  bodyParagraphs,
  carouselFormat,
  carouselTheme,
  type CarouselConfig,
  type CarouselSlide,
  imageCapacity,
  normalizeSlideLayout,
  parseInlineMarks,
  photoArrangement,
  showsBody,
  sanitizeSvg,
  slideAlign,
  slidePosition,
  slideTone,
  smartQuotes,
  titleLines,
  TYPE_SCALE,
  usesImages,
} from "./carousel";

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

/** Enough to hold copy over most photographs without turning them to mud. */
export const DEFAULT_VEIL = 0.6;

/** Only real bytes are painted. A stored key that reached the renderer has nothing to draw. */
function painted(ref: string | undefined) {
  return ref?.startsWith("data:") ? ref : undefined;
}

export function Slide({
  slide: sourceSlide,
  config,
  index,
  exportMode = false,
  videoPreview = false,
  playing = true,
  onVideoDuration,
}: {
  slide: CarouselSlide;
  config: CarouselConfig;
  index: number;
  exportMode?: boolean;
  videoPreview?: boolean;
  playing?: boolean;
  onVideoDuration?: (duration: number) => void;
}) {
  const slide = normalizeSlideLayout(sourceSlide);
  const theme = carouselTheme(config.theme);
  const visual = slide.layout === "note" ? slide.visual : undefined;
  const position = slidePosition(slide, theme, carouselFormat(config.format));
  const lines = titleLines(slide.title);
  // Title-only layouts keep their body in the document but never draw it.
  const paragraphs = showsBody(slide.layout) ? bodyParagraphs(slide.body) : [];
  const background = painted(slide.background);
  const pictures = usesImages(slide)
    ? (slide.images ?? []).slice(0, imageCapacity(slide)).map(painted)
    : [];
  const diagram = visual === "diagram" && slide.diagram ? sanitizeSvg(slide.diagram) : "";
  const isLast = index === config.slides.length - 1;
  const showArrow = config.arrow !== false && !isLast;

  const style = {
    "--title-size": `${TYPE_SCALE.heading}cqw`,
    "--reading-size": `${TYPE_SCALE.reading}cqw`,
    "--metadata-size": `${theme === "cinematic" ? 2.4 : TYPE_SCALE.metadata}cqw`,
    "--video-top": `${HORIZONTAL_VIDEO_FRAME.y / HORIZONTAL_VIDEO_FRAME.canvasHeight * 100}%`,
    "--video-height": `${HORIZONTAL_VIDEO_FRAME.height / HORIZONTAL_VIDEO_FRAME.canvasHeight * 100}%`,
    "--video-zoom": String(slide.video?.zoom ?? 1),
    "--veil": String(slide.veil ?? DEFAULT_VEIL),
  } as CSSProperties;

  // A headline opening on a quote mark sits visibly indented against the copy below
  // it unless the mark is hung into the margin. CSS hanging-punctuation is Safari
  // only, so the indent is set by hand, and only where there is a margin to hang into.
  const hangs = /^["“”'‘’]/.test(smartQuotes(lines[0])) && slideAlign(slide, theme) === "left";

  const copy = (
    <>
      {theme === "cinematic" && slide.label && <span className="slide-label">{slide.label}</span>}
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

  const classes = [
    "carousel-slide",
    slide.video?.framing === "horizontal" ? "video-horizontal" : "",
    `template-${theme}`,
    `format-${carouselFormat(config.format)}`,
    `layout-${slide.layout}`,
    visual ? `visual-${visual}` : "",
    visual === "diagram" || pictures.length > 0 ? "has-visual" : "",
    `pos-${position}`,
    `align-${slideAlign(slide, theme)}`,
    `tone-${slideTone(slide, theme)}`,
    background || slide.video ? "has-background" : "",
    config.mark ? "has-mark" : "",
    pictures.length ? `has-pictures pictures-${pictures.length} photos-${photoArrangement(pictures.length)}` : "",
    diagram ? "has-diagram" : "",
    exportMode ? "export-slide" : "",
  ].filter(Boolean).join(" ");

  return (
    <article className={classes} style={style} data-export-slide={exportMode ? "true" : undefined}>
      {/* Pictures are <img> elements, not CSS backgrounds. Chrome silently drops a
          style value past a few megabytes, and a data URL of a photograph is one. */}
      <div className="slide-media">{slide.video
        ? videoPreview
          ? <VideoBackground key={slide.video.key} clip={slide.video} playing={playing} onDuration={onVideoDuration} />
          : <img key={`${slide.video.key}:${slide.video.start}`} className="slide-image" src={videoUrl(slide.video.key, "/poster")} data-video-key={slide.video.key} data-video-start={slide.video.start} alt="" />
        : background && <img className="slide-image" src={background} alt="" />}</div>
      <div className="slide-overlay" />
      {slide.showHeader !== false && (
        <header className="slide-head">
          {config.mark && <span className="slide-mark">{config.mark}</span>}
          <span className="slide-counter">{page}</span>
        </header>
      )}
      <div className="slide-content">{copy}</div>
      {/* Sanitised at parse time and again here, so a diagram can draw but never run. */}
      {visual === "diagram" && (
        <div className="slide-diagram">
          {diagram
            ? <div className="slide-diagram-svg" dangerouslySetInnerHTML={{ __html: diagram }} />
            : <div className="slide-diagram-empty">Add an SVG diagram under Content</div>}
        </div>
      )}
      {pictures.length > 0 && (
        <div className="slide-pictures">
          {pictures.map((picture, pictureIndex) => (
            picture
              ? <img className="slide-picture" src={picture} alt="" key={pictureIndex} />
              : <div className="slide-picture is-missing" key={pictureIndex} />
          ))}
        </div>
      )}
      {slide.showFooter !== false && (
        <footer className="slide-meta">
          <span className="meta-author">{config.author}</span>
          {showArrow && <span className="slide-arrow" aria-hidden="true">→</span>}
        </footer>
      )}
    </article>
  );
}

/** Offscreen full-size slides. The PDF export reads these, never the preview. */
export function ExportStage({ config }: { config: CarouselConfig }) {
  return (
    <div className="export-stage" aria-hidden="true">
      {config.slides.map((slide, index) => (
        <Slide key={slide.id} slide={slide} config={config} index={index} exportMode />
      ))}
    </div>
  );
}
