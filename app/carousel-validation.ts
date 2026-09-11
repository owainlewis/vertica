/** Shared document bounds for imports and API writes. */
export const MAX_SLIDES = 20;

export function validateCarouselSlides(slides: unknown): asserts slides is Record<string, unknown>[] {
  if (!Array.isArray(slides) || slides.length === 0) throw new Error("Add at least one slide.");
  if (slides.length > MAX_SLIDES) throw new Error(`Keep the carousel to ${MAX_SLIDES} slides or fewer.`);

  const ids = new Set<string>();
  slides.forEach((slide: unknown, index) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
      throw new Error(`Slide ${index + 1} must be an object.`);
    }
    const value = (slide as Record<string, unknown>).id;
    const id = typeof value === "string" ? value.trim() : "";
    // Older documents omit IDs. The client assigns those when importing them.
    if (!id) return;
    if (ids.has(id)) throw new Error(`Slide ${index + 1} has a duplicate id: ${id}.`);
    ids.add(id);
  });
}
