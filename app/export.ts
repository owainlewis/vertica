import { dataUrlToBytes } from "./data-url";
import { createZip } from "./zip";
import { videoFrame, videoRequest } from "./video-client";
import type { VideoBackground } from "./video-formats";

/** LinkedIn's portrait page box, in points. Instagram takes the same 4:5 frame. */
export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;
/** Pages are rasterised at this multiple of the page box, matching what Canva ships. */
const EXPORT_SCALE = 2;
const PAGE_TIMEOUT_MS = 30000;

/**
 * Chrome freezes image decoding in a hidden tab, and the rasteriser waits on it with
 * no timeout of its own. Without this guard, switching tabs mid-export leaves the
 * button spinning forever with no way back.
 */
function withTimeout<T>(work: Promise<T>, message: string) {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), PAGE_TIMEOUT_MS)),
  ]);
}

export function fileNameFor(title: string, extension = "pdf") {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "carousel"}.${extension}`;
}

function stageNodes(expectedPages: number) {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-export-slide='true']"));
  if (nodes.length !== expectedPages) throw new Error("The slides are not ready to export.");
  return nodes;
}

/**
 * Backgrounds arrive as data URLs that the browser decodes lazily. The rasteriser
 * serialises whatever is ready at that instant, so a slide whose photograph has not
 * decoded yet is written out without it. Forcing every background to decode first is
 * what stops the occasional image-less page.
 */
async function decodeBackgrounds(nodes: HTMLElement[]) {
  // Slide pictures race the rasteriser the same way as the background.
  const images = nodes.flatMap((node) => Array.from(node.querySelectorAll("img")));
  // A picture that will not decode should not sink the whole export.
  await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
}

/** Rasterises every mounted export slide, in order, at full export resolution. */
async function rasteriseStage(expectedPages: number) {
  const nodes = stageNodes(expectedPages);
  await document.fonts.ready;
  // Still exports use the chosen clip's first frame. A failed video request must
  // stop the export instead of silently leaving the background blank.
  const frames = new Map<string, string>();
  for (const node of nodes) {
    const image = node.querySelector<HTMLImageElement>("img[data-video-key]");
    if (!image) continue;
    const key = image.dataset.videoKey!;
    const start = Number(image.dataset.videoStart);
    const frameId = `${key}:${start}`;
    const frame = frames.get(frameId) ?? await videoFrame({ key, start, duration: 1 });
    frames.set(frameId, frame);
    image.src = frame;
    await image.decode();
  }
  await decodeBackgrounds(nodes);

  const { toJpeg } = await import("html-to-image");
  const pages: string[] = [];

  for (let index = 0; index < nodes.length; index += 1) {
    pages.push(
      await withTimeout(
        toJpeg(nodes[index], {
          width: SLIDE_WIDTH,
          height: SLIDE_HEIGHT,
          pixelRatio: EXPORT_SCALE,
          quality: 0.94,
          backgroundColor: getComputedStyle(nodes[index]).backgroundColor,
        }),
        `Slide ${index + 1} timed out while rendering. Keep this tab in front while exporting, then try again.`,
      ),
    );
  }

  return pages;
}

/** Capture the existing artwork with alpha, then composite it onto the clip. */
export async function exportStageToMp4(fileName: string, expectedPages: number, index: number, video: VideoBackground) {
  const node = stageNodes(expectedPages)[index];
  if (!node) throw new Error("Select a video slide to export.");
  await document.fonts.ready;
  await decodeBackgrounds([node]);
  const { toPng } = await import("html-to-image");
  const overlay = await withTimeout(toPng(node, {
    width: SLIDE_WIDTH, height: SLIDE_HEIGHT, pixelRatio: 1,
    style: { background: "transparent" },
    filter: (element) => !(element instanceof Element && element.classList.contains("slide-image")),
  }), "The text overlay timed out. Keep this tab in front and try again.");
  const response = await videoRequest("/video-exports", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ video, overlay }),
  });
  downloadBlob(await response.blob(), fileName);
}

export async function exportStageToPdf(fileName: string, expectedPages: number) {
  const pages = await rasteriseStage(expectedPages);
  const { jsPDF } = await import("jspdf");

  const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [SLIDE_WIDTH, SLIDE_HEIGHT], hotfixes: ["px_scaling"] });
  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage([SLIDE_WIDTH, SLIDE_HEIGHT], "portrait");
    pdf.addImage(page, "JPEG", 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT, undefined, "SLOW");
  });
  pdf.save(fileName);
}

/** One numbered JPEG per slide, zipped, ready to upload to Instagram in order. */
export async function exportStageToZip(fileName: string, expectedPages: number) {
  const pages = await rasteriseStage(expectedPages);
  const stem = fileName.replace(/\.zip$/, "");

  const zip = createZip(
    pages.map((page, index) => ({
      name: `${stem}-${String(index + 1).padStart(2, "0")}.jpg`,
      bytes: dataUrlToBytes(page),
    })),
  );

  downloadBlob(zip, fileName);
}

/**
 * Firefox and Safari drop a download whose anchor was never in the document, or
 * whose object URL is revoked in the same tick as the click. Both were true here, so
 * the ZIP could silently produce nothing outside Chrome.
 */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
