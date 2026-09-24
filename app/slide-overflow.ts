/** Check rendered copy against the frame, furniture and other content. Sizes stay fixed. */
export function slideHasOverflow(slide: HTMLElement | null): boolean {
  if (!slide) return false;
  const frame = slide.getBoundingClientRect();
  if (!frame.width || !frame.height) return false;
  const header = slide.querySelector(".slide-head")?.getBoundingClientRect();
  const footer = slide.querySelector(".slide-meta")?.getBoundingClientRect();
  const top = header?.bottom ?? frame.top;
  const bottom = footer?.top ?? frame.bottom;
  const copy = [...slide.querySelectorAll(".slide-content h2, .slide-content p")].map((node) => node.getBoundingClientRect());
  const figure = slide.querySelector(".slide-pictures, .slide-diagram-svg")?.getBoundingClientRect();
  return copy.some((rect, index) =>
    rect.top < top - 1 || rect.bottom > bottom + 1 || rect.left < frame.left - 1 || rect.right > frame.right + 1 ||
    copy.slice(index + 1).some((other) => rect.top < other.bottom - 1 && rect.bottom > other.top + 1) ||
    (figure && rect.top < figure.bottom - 1 && rect.bottom > figure.top + 1),
  );
}
