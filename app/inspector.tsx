import { ChevronDown, Download, Film, Images, Layers3, X } from "lucide-react";
import { useState } from "react";
import {
  type CarouselConfig,
  type CarouselSlide,
  type CarouselTheme,
  type CarouselFormat,
  carouselFormat,
  imageCapacity,
  type SlideAlign,
  slideAlign,
  type SlideLayout,
  slidePosition,
  type SlidePosition,
  slideTone,
  slideTypeface,
  type SlideVisual,
  showsBody,
  usesImages,
} from "./carousel";
import { isImageKey } from "./image-formats";
import { DEFAULT_VEIL } from "./slide";
import { boundVideoBackground, MAX_CLIP_SECONDS, type VideoBackground } from "./video-formats";

export const layoutNames: Record<SlideLayout, string> = {
  cover: "Cover", content: "Body 1", note: "Body 2", closing: "CTA",
};

const layoutHints: Record<SlideLayout, string> = {
  cover: "A clear promise in the selected typeface, with one short supporting line.",
  content: "A clear lead and short, readable paragraphs. One idea per slide.",
  note: "A short statement or visual example. Add pictures or a diagram under Content.",
  closing: "One useful next action, with a short supporting line.",
};

const positionLabels: Record<SlidePosition, string> = { top: "Top", middle: "Middle", bottom: "Bottom" };
const alignLabels: Record<SlideAlign, string> = { left: "Left", center: "Centred" };

type InspectorTab = "content" | "layout" | "design";

/** Everything a panel needs to read and change the deck. */
type PanelProps = {
  config: CarouselConfig;
  slide: CarouselSlide;
  theme: CarouselTheme;
  /** Patch the selected slide. `key` groups a burst of edits into one undo step. */
  updateSlide: (patch: Partial<CarouselSlide>, key?: string) => void;
  /** Replace the whole deck, for settings that apply to every slide. */
  commit: (next: CarouselConfig, key?: string) => void;
};

type InspectorProps = PanelProps & {
  onAddPicture: () => void;
  onChooseImage: () => void;
  onChooseVideo: () => void;
  onEditJson: () => void;
  onDownloadJson: () => void;
};

function Segmented<T extends string>({ options, value, onChange, label }: {
  options: T[];
  value: T;
  onChange: (value: T) => void;
  label?: string | ((option: T) => string);
}) {
  return (
    <div className="segmented" aria-label={typeof label === "string" ? label : undefined}>
      {options.map((option) => (
        <button type="button" key={option} aria-pressed={value === option} className={value === option ? "active" : ""} onClick={() => onChange(option)}>
          {typeof label === "function" ? label(option) : option}
        </button>
      ))}
    </div>
  );
}

export default function Inspector(props: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("content");
  const tabs: Array<[InspectorTab, string]> = [["content", "Content"], ["layout", "Layout"], ["design", "Design"]];
  return (
    <aside className="inspector">
      <div className="inspector-tabs" role="group" aria-label="Slide settings">
        {tabs.map(([id, name]) => (
          <button key={id} aria-pressed={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} type="button">{name}</button>
        ))}
      </div>
      {tab === "layout" ? <LayoutPanel {...props} /> : tab === "content" ? <ContentPanel {...props} /> : <DesignPanel {...props} />}
    </aside>
  );
}

function LayoutPanel({ config, slide, theme, updateSlide, commit }: PanelProps) {
  const position = slidePosition(slide, theme, carouselFormat(config.format));
  const align = slideAlign(slide, theme);
  // Visual captions sit above or below the figure; only text slides can centre.
  const positions: SlidePosition[] = slide.layout === "note" && slide.visual ? ["top", "bottom"] : ["top", "middle", "bottom"];

  return (
    <div className="inspector-panel">
      <span className="field-label">Typography</span>
      <Segmented options={["sans", "serif"] as const} value={slideTypeface(slide, config.theme)} onChange={(typeface) => updateSlide({ typeface })} label={(value) => value === "sans" ? "Sans · Geist" : "Serif · Signifier"} />
      <button type="button" className="text-button subtle" onClick={() => commit({ ...config, slides: config.slides.map((each) => ({ ...each, typeface: slideTypeface(slide, config.theme) })) })}>Apply typography to all slides</button>
      <label className="field-label" htmlFor="slide-layout">Slide type</label>
      <div className="select-wrap">
        <select id="slide-layout" value={slide.layout} onChange={(event) => updateSlide({ layout: event.target.value as SlideLayout })}>
          {(Object.keys(layoutNames) as SlideLayout[]).map((layout) => <option value={layout} key={layout}>{layoutNames[layout]}</option>)}
        </select>
        <ChevronDown size={14} />
      </div>

      <span className="field-label">Text position</span>
      {slide.video?.framing === "horizontal" ? <p className="field-hint">Text stays above the footage in Horizontal framing.</p> : <Segmented options={positions} value={position} onChange={(next) => updateSlide({ position: next })} label={(option) => positionLabels[option]} />}

      <span className="field-label">Alignment</span>
      <Segmented options={["left", "center"] as SlideAlign[]} value={align} onChange={(next) => updateSlide({ align: next })} label={(option) => alignLabels[option]} />

      <button type="button" className="text-button subtle" onClick={() => commit({ ...config, slides: config.slides.map((each) => ({ ...each, ...(slide.video?.framing === "horizontal" ? {} : { position }), align })) })}>
        {slide.video?.framing === "horizontal" ? "Apply alignment to all slides" : "Apply position and alignment to all slides"}
      </button>

      <p className="field-hint">{layoutHints[slide.layout]}</p>

      <span className="field-label">Header and footer</span>
      <label className="check-row"><input type="checkbox" checked={slide.showHeader !== false} onChange={(event) => updateSlide({ showHeader: event.target.checked ? undefined : false })} /> Show header</label>
      <label className="check-row"><input type="checkbox" checked={slide.showFooter !== false} onChange={(event) => updateSlide({ showFooter: event.target.checked ? undefined : false })} /> Show footer</label>
      <p className="field-hint">Header: series label and page number. Footer: author and swipe arrow. These settings apply to this slide.</p>
    </div>
  );
}

function ContentPanel({ config, slide, updateSlide, onAddPicture, onChooseImage, onChooseVideo }: InspectorProps) {
  const images = slide.images ?? [];
  const capacity = imageCapacity(slide);
  const isDiagram = slide.layout === "note" && slide.visual === "diagram";

  function removePicture(at: number) {
    const remaining = images.filter((_, index) => index !== at);
    updateSlide({ images: remaining.length ? remaining : undefined });
  }

  return (
    <div className="inspector-panel">
      <button className="wide-upload" type="button" onClick={config.format === "video" ? onChooseVideo : onChooseImage}>
        {config.format === "video" ? <Film size={15} /> : <Images size={15} />}
        {config.format === "video" ? (slide.video ? "Change video" : "Choose a video") : (slide.background ? "Change image" : "Choose an image")}
      </button>
      {config.format === "video" && !slide.video && <p className="field-hint">Add an MP4 to this slide. Reuse a clip across slides or choose different footage for each.</p>}
      <label className="field-label" htmlFor="slide-label">Slide label</label>
      <input id="slide-label" maxLength={30} value={slide.label ?? ""} placeholder="e.g. Rule 01" onChange={(event) => updateSlide({ label: event.target.value || undefined }, "label")} />
      <label className="field-label" htmlFor="headline">Headline</label>
      <textarea id="headline" maxLength={120} rows={5} value={slide.title} onChange={(event) => updateSlide({ title: event.target.value }, "title")} />
      <div className="character-count" style={{ visibility: slide.title.length >= 100 ? "visible" : "hidden" }}>{slide.title.length} / 120</div>
      <details className="format-help"><summary>Formatting help</summary><p className="field-hint"><em>|</em> starts a headline line. <em>*italic*</em> adds emphasis. <em>**bold**</em> marks a phrase. A blank line starts a paragraph.</p></details>
      {slide.layout === "note" && (
        <>
          <label className="field-label" htmlFor="slide-visual">Visual example</label>
          <div className="select-wrap">
            <select id="slide-visual" value={slide.visual ?? ""} onChange={(event) => updateSlide({ visual: event.target.value ? event.target.value as SlideVisual : undefined })}>
              <option value="">Text only</option>
              <option value="photos">Pictures</option>
              <option value="diagram">Diagram</option>
            </select>
            <ChevronDown size={14} />
          </div>
        </>
      )}
      {showsBody(slide.layout) ? (
        <>
          <label className="field-label" htmlFor="body">Supporting copy</label>
          <textarea id="body" maxLength={280} rows={6} value={slide.body} onChange={(event) => updateSlide({ body: event.target.value }, "body")} />
        </>
      ) : (
        <p className="field-hint">
          {layoutNames[slide.layout]} slides draw the headline only, so nothing can crowd the {isDiagram ? "figure" : slide.visual === "photos" ? "pictures" : "statement"}.
          {slide.body ? " The supporting copy is kept and comes back if you change the slide type." : ""}
        </p>
      )}
      {isDiagram && (
        <>
          <label className="field-label" htmlFor="diagram">Diagram SVG</label>
          <textarea className="svg-editor" id="diagram" rows={8} spellCheck={false} value={slide.diagram ?? ""} onChange={(event) => updateSlide({ diagram: event.target.value || undefined }, "diagram")} placeholder='<svg viewBox="0 0 800 500">…</svg>' />
          <p className="field-hint">Paste inline SVG. Use <em>currentColor</em> for strokes and text so it takes the slide’s ink on any ground. Scripts and external references are stripped. Find Copy AI prompt in Design → Project data → Edit JSON config.</p>
        </>
      )}
      {usesImages(slide) && (
        <>
          <span className="field-label">Pictures · {images.length} of {capacity}</span>
          {images.length > 0 && (
            <ul className="picture-list">
              {images.map((image, index) => (
                <li
                  key={`${index}-${image.slice(-24)}`}
                  className={isImageKey(image) ? "is-missing" : ""}
                  style={isImageKey(image) ? undefined : { backgroundImage: `url(${image})` }}
                  title={isImageKey(image) ? "Not available in this browser" : `Picture ${index + 1}`}
                >
                  <button type="button" onClick={() => removePicture(index)} aria-label={`Remove picture ${index + 1}`}><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <p className="field-hint">One picture fills the figure area. Multiple pictures form a contained grid, with each image shown in full.</p>
          {images.length < capacity ? (
            <button className="wide-upload" type="button" onClick={onAddPicture} style={{ marginTop: 8 }}><Images size={15} /> Add a picture</button>
          ) : (
            <p className="field-hint">This layout is full. Remove a picture to add another.</p>
          )}
        </>
      )}
    </div>
  );
}

function VideoClipFields({ video, onChange }: { video: VideoBackground; onChange: (video: VideoBackground, key: string) => void }) {
  const source = video.sourceDuration;
  return (
    <div className="video-clip-fields">
      <label className="field-label" htmlFor="video-start">Start (s)
        <input id="video-start" type="number" min={0} max={Math.max(0, (source ?? 0) - video.duration)} disabled={!source} step={0.1} value={video.start}
          onChange={(event) => { if (source) onChange(boundVideoBackground({ ...video, start: Number(event.target.value) }, source), "video-start"); }} />
      </label>
      <label className="field-label" htmlFor="video-duration">Duration (s)
        <input id="video-duration" type="number" min={1} max={Math.min(MAX_CLIP_SECONDS, (source ?? 1) - video.start)} disabled={!source} step={0.1} value={video.duration}
          onChange={(event) => {
            if (!source) return;
            const longest = Math.min(MAX_CLIP_SECONDS, source - video.start);
            onChange({ ...video, duration: Math.max(1, Math.min(longest, Number(event.target.value))) }, "video-duration");
          }} />
      </label>
    </div>
  );
}

function DesignPanel({ config, slide, theme, updateSlide, commit, onChooseImage, onChooseVideo, onEditJson, onDownloadJson }: InspectorProps) {
  const tone = slideTone(slide, theme);
  const veil = Math.round((slide.veil ?? DEFAULT_VEIL) * 100);
  const toneNames = { paper: "Paper", sage: "Sage", black: "Black" } as const;
  const tones = ["paper", "sage", "black"] as const;

  return (
    <div className="inspector-panel">
      <label className="field-label" htmlFor="carousel-format">Carousel format</label>
      <div className="select-wrap">
        <select id="carousel-format" value={carouselFormat(config.format)} onChange={(event) => commit({ ...config, format: event.target.value as CarouselFormat })}>
          <option value="image">Image carousel</option>
          <option value="video">Video carousel</option>
        </select>
        <ChevronDown size={14} />
      </div>
      <p className="field-hint">{config.format === "video" ? "One MP4 per slide, with your text over b-roll. Add a video to every slide before exporting." : "Numbered still images, ready to upload in order."}</p>
      <p className="field-hint">Cinematic. Choose Sans or Serif typography under Layout. Use photos, video or a quiet solid background.</p>

      <h3 className="settings-heading settings-divider">This slide</h3>
      <span className="field-label">Background colour</span>
      <Segmented options={[...tones]} value={tone} onChange={(next) => updateSlide({ tone: next })} label={(option) => toneNames[option]} />

      <span className="field-label">Background photo</span>
      <button className="wide-upload" type="button" onClick={onChooseImage}><Images size={15} /> {slide.background ? "Choose another image" : "Choose from media"}</button>

      <span className="field-label">Video background</span>
      <button className="wide-upload" type="button" onClick={onChooseVideo}><Film size={15} /> {slide.video ? "Change video" : "Choose a video"}</button>
      {slide.video && (
        <>
          <span className="field-label">Video framing</span>
          <Segmented options={["fill", "horizontal"] as const} value={slide.video.framing ?? "fill"} onChange={(framing) => updateSlide({ video: { ...slide.video!, framing } })} label={(value) => value === "fill" ? "Fill slide" : "Horizontal"} />
          {slide.video.framing === "horizontal" && <>
            <label className="field-label range-label" htmlFor="video-zoom">Zoom <span>{(slide.video.zoom ?? 1).toFixed(2)}×</span></label>
            <input id="video-zoom" className="range" type="range" min={1} max={1.3} step={0.01} value={slide.video.zoom ?? 1} onChange={(event) => updateSlide({ video: { ...slide.video!, zoom: Number(event.target.value) } }, "video-zoom")} />
            <p className="field-hint">Text above landscape footage on a black canvas. At 1× the whole clip fits; zoom crops the edges. Keep the copy short.</p>
          </>}
          <VideoClipFields video={slide.video} onChange={(video, key) => updateSlide({ video }, key)} />
          <p className="field-hint">{slide.video.sourceDuration ? `Source: ${slide.video.sourceDuration.toFixed(1)}s. ` : "Loading source duration… "}Silent. Export → Video carousel creates numbered MP4s when every slide has video. Video slide exports just this clip.</p>
          <button type="button" className="text-button" onClick={() => updateSlide({ video: undefined, veil: undefined })}>Remove video</button>
        </>
      )}
      {isImageKey(slide.background) && (
        <p className="field-hint warning">
          This slide has an image that is not available in this browser, so it cannot be shown or exported here.
          It is kept in the saved carousel. If it predates media persistence, add it to Media again or choose a replacement from your library.
        </p>
      )}
      {(slide.background || slide.video) && slide.video?.framing !== "horizontal" && (
        <>
          <label className="field-label range-label" htmlFor="veil">
            <span>Background veil</span>
            <span>{veil}%</span>
          </label>
          <input id="veil" className="range" type="range" min={0} max={100} step={5} value={veil} onChange={(event) => updateSlide({ veil: Number(event.target.value) / 100 }, "veil")} />
          <p className="field-hint">Raise the veil to make text easier to read over a busy background.</p>
          {slide.background && <button type="button" className="text-button" onClick={() => updateSlide({ background: undefined, veil: undefined })}>Remove image</button>}
        </>
      )}

      <h3 className="settings-heading settings-divider">All slides</h3>
      <label className="field-label" htmlFor="mark">Series label</label>
      <input id="mark" maxLength={30} value={config.mark ?? ""} placeholder="AI Engineer" onChange={(event) => commit({ ...config, mark: event.target.value }, "mark")} />
      <label className="field-label" htmlFor="author">Footer name</label>
      <input id="author" maxLength={40} value={config.author} onChange={(event) => commit({ ...config, author: event.target.value }, "author")} />
      <label className="check-row"><input type="checkbox" checked={config.arrow !== false} onChange={(event) => commit({ ...config, arrow: event.target.checked ? undefined : false })} /> Swipe arrow on every slide but the last</label>
      <details className="config-tools">
        <summary>Project data</summary>
        <button type="button" onClick={onEditJson}><Layers3 size={15} /> Edit JSON config</button>
        <button type="button" onClick={onDownloadJson}><Download size={15} /> Download config</button>
      </details>
    </div>
  );
}
