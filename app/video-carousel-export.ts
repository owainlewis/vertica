import type { CarouselSlide } from "./carousel.ts";
import { parseVideoBackground, type VideoBackground } from "./video-formats.ts";
import { createZip } from "./zip.ts";

/** Bound browser memory while collecting full-resolution clips. */
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export function videoCarouselClips(slides: CarouselSlide[]): VideoBackground[] {
  if (!slides.length) throw new Error("Add at least one video slide.");
  return slides.map((slide, index) => {
    if (!slide.video) throw new Error(`Slide ${index + 1} needs a video. Choose one in Content before exporting the video carousel.`);
    try {
      // Older decks omit sourceDuration. The export endpoint always checks the
      // interval against stored source metadata before invoking the encoder.
      return parseVideoBackground(slide.video);
    } catch (error) {
      throw new Error(`Slide ${index + 1}: ${error instanceof Error ? error.message : "Check the video clip."}`);
    }
  });
}

/** Validate the whole deck first; the server has one encoder, so never fan out. */
export async function renderVideoCarousel(
  stem: string,
  slides: CarouselSlide[],
  render: (index: number, video: VideoBackground) => Promise<Blob>,
  onProgress: (message: string) => void,
): Promise<Blob> {
  const clips = videoCarouselClips(slides);
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  let totalBytes = 0;
  for (let index = 0; index < clips.length; index++) {
    onProgress(`Rendering video ${index + 1} of ${clips.length}…`);
    try {
      const blob = await render(index, clips[index]);
      totalBytes += blob.size;
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error("The video ZIP exceeds 256 MB. Shorten the clips or export each video slide separately.");
      files.push({ name: `${stem}-${String(index + 1).padStart(2, "0")}.mp4`, bytes: new Uint8Array(await blob.arrayBuffer()) });
    } catch (error) {
      throw new Error(`Slide ${index + 1} could not be exported. ${error instanceof Error ? error.message : "Try again."}`);
    }
  }
  onProgress("Packing video files…");
  return createZip(files);
}
