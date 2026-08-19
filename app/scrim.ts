import type { LumaBands, SlideLayout, SlidePosition } from "./carousel";

/**
 * The scrim is the dark wash between the photograph and the type. It used to be one
 * fixed gradient for every image, which is the wrong answer twice over: a bright sky
 * swallowed the cream text, and an already-dark shot got muddied for nothing.
 *
 * So it is built from the measured brightness of the third of the image the text
 * actually sits over. The target is a ground dark enough to clear WCAG AA for the
 * cream (#f6f1e7) at display size, and no darker.
 */

/**
 * How bright the ground under the text is allowed to end up, in the same Rec. 709
 * luma that measureLuma reports. Cream (#f6f1e7) over a ground this dark clears the
 * 3:1 that display-size text needs with room to spare, and it is about where the
 * reference covers sit: dark enough to read cleanly, light enough that the photograph
 * underneath is still a photograph.
 */
const TARGET = 0.2;
/** What the fixed gradient used to apply, and what a deck with no measurement gets. */
const DEFAULT_PEAK = 0.9;
/**
 * A photograph already darker than TARGET needs no help, but it still gets this much.
 * Some separation between type and image reads as deliberate; none reads as an
 * accident. Kept low, or an already-dark shot is muddied for nothing, which is half
 * of what the fixed gradient got wrong.
 */
const MIN_PEAK = 0.25;
const MAX_PEAK = 0.92;

export function bandFor(position: SlidePosition): 0 | 1 | 2 {
  return position === "top" ? 0 : position === "middle" ? 1 : 2;
}

/**
 * How opaque the scrim has to be under the text. Compositing black at alpha a over a
 * ground of brightness L leaves L·(1−a), so reaching TARGET needs a = 1 − TARGET/L.
 * A photograph already darker than the target needs nothing, but it still gets the
 * floor: some separation reads as deliberate, none reads as an accident.
 */
export function scrimPeak(luma: number | undefined) {
  if (luma === undefined) return DEFAULT_PEAK;
  if (luma <= 0) return MIN_PEAK;
  return round(clamp(1 - TARGET / luma, MIN_PEAK, MAX_PEAK));
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function rgba(alpha: number) {
  return `rgb(9 9 7 / ${round(clamp(alpha, 0, 1))})`;
}

/**
 * A cover holds one centred block, so it wants even darkening through the middle.
 * Content slides want the weight where their text sits and the photograph left alone
 * everywhere else, which is what makes the image still read as an image.
 */
export function scrimGradient(
  layout: SlideLayout,
  position: SlidePosition,
  luma: LumaBands | undefined,
): string {
  const peak = scrimPeak(luma?.[bandFor(position)]);

  if (layout === "cover") {
    return `radial-gradient(115% 82% at 50% 47%, ${rgba(peak * 0.62)} 0%, ${rgba(peak * 0.56)} 48%, ${rgba(peak * 0.8)} 100%)`;
  }

  // Two stops of shoulder above the text block and a solid floor under it. The top
  // stop is held at a little over half the peak so the header end never goes flat.
  if (position === "top") {
    return `linear-gradient(180deg, ${rgba(peak)} 0%, ${rgba(peak * 0.86)} 26%, ${rgba(peak * 0.3)} 62%, ${rgba(peak * 0.4)} 100%)`;
  }
  if (position === "middle") {
    return `linear-gradient(180deg, ${rgba(peak * 0.5)} 0%, ${rgba(peak * 0.92)} 34%, ${rgba(peak * 0.92)} 66%, ${rgba(peak * 0.5)} 100%)`;
  }
  return `linear-gradient(180deg, ${rgba(peak * 0.5)} 0%, ${rgba(peak * 0.18)} 22%, ${rgba(peak * 0.46)} 52%, ${rgba(peak * 0.89)} 80%, ${rgba(peak)} 100%)`;
}

/**
 * Mean brightness of the top, middle and bottom third of an image. Sampled from a
 * 24×30 draw rather than the full photograph: the scrim only needs to know roughly
 * how bright a third of the frame is, and a small draw makes this cheap enough to run
 * on every upload. Rec. 709 luma, because that is what the eye does with the channels.
 */
export function measureLuma(image: HTMLImageElement): LumaBands {
  const width = 24;
  const height = 30;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [0.5, 0.5, 0.5];
  context.drawImage(image, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  const totals = [0, 0, 0];
  const counts = [0, 0, 0];

  for (let y = 0; y < height; y += 1) {
    const band = Math.min(2, Math.floor((y / height) * 3));
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      totals[band] += (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
      counts[band] += 1;
    }
  }

  return totals.map((total, index) => round(total / counts[index])) as LumaBands;
}

/** Decodes a data URL and measures it. Resolves undefined if the image will not load. */
export function measureDataUrl(dataUrl: string): Promise<LumaBands | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        resolve(measureLuma(image));
      } catch {
        // A tainted or zero-sized canvas is not worth failing an upload over.
        resolve(undefined);
      }
    };
    image.onerror = () => resolve(undefined);
    image.src = dataUrl;
  });
}
