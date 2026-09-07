import { slideImageRefs, type CarouselConfig } from "./carousel";
import { isImageKey, loadImages, putImage } from "./image-store";
import type { CarouselSummary, MediaAsset } from "../server/store.ts";

export type { CarouselSummary, MediaAsset } from "../server/store.ts";

/** A save refused because someone else wrote first. Reloading is the only fix. */
export class StaleSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleSaveError";
  }
}

export type SessionState = { gated: boolean; authorised: boolean };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body as { error?: string }).error ?? "The request failed.";
    throw response.status === 409 ? new StaleSaveError(message) : new Error(message);
  }
  return body as T;
}

export function getSession() {
  return call<SessionState>("/session");
}

export function signIn(password: string) {
  return call<{ ok: true }>("/session", { method: "POST", body: JSON.stringify({ password }) });
}

export async function listCarousels() {
  return (await call<{ carousels: CarouselSummary[] }>("/carousels")).carousels;
}

export function listMedia(cursor?: string | null) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return call<{ media: MediaAsset[]; nextCursor: string | null }>(`/media${query}`);
}

export function deleteMedia(key: string) {
  return call<{ ok: true }>(`/media/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export function deleteCarousel(id: string) {
  return call<{ ok: true }>(`/carousels/${id}`, { method: "DELETE" });
}

/**
 * Moves any freshly uploaded image bytes into the durable media store, so what
 * reaches the database is keys. Slides that already carry a key are left alone.
 */
async function externalise(ref: string | undefined) {
  if (!ref || isImageKey(ref)) return ref;
  return putImage(ref);
}

async function storeMedia(config: CarouselConfig): Promise<CarouselConfig> {
  const slides = await Promise.all(
    config.slides.map(async (slide) => {
      const background = await externalise(slide.background);
      const images = slide.images ? await Promise.all(slide.images.map(externalise)) : undefined;
      return {
        ...slide,
        ...(background ? { background } : {}),
        ...(images ? { images: images.filter((ref): ref is string => Boolean(ref)) } : {}),
      };
    }),
  );
  return { ...config, slides };
}

/**
 * Resolves stored keys back into data URLs the slide renderer can paint.
 *
 * A key with no bytes behind it means the media is missing, or that this browser
 * cannot reach the durable store. The key is kept exactly as it was. Replacing it
 * with undefined is what used to destroy data: the editor would hold the stripped
 * config, autosave on the next keystroke, and write a deck with no image references
 * at all over the one in the database. The renderer paints data URLs only, so an
 * unresolved key shows nothing and saves back unharmed.
 */
export async function resolveMedia(config: CarouselConfig): Promise<CarouselConfig> {
  const keys = config.slides.flatMap(slideImageRefs).filter(isImageKey);
  const images = await loadImages(keys);
  const resolve = (ref: string) => (isImageKey(ref) && images[ref]) || ref;
  return {
    ...config,
    slides: config.slides.map((slide) => ({
      ...slide,
      ...(slide.background ? { background: resolve(slide.background) } : {}),
      ...(slide.images ? { images: slide.images.map(resolve) } : {}),
    })),
  };
}


export async function saveCarousel(id: string | null, config: CarouselConfig, version: number | null) {
  const stored = await storeMedia(config);
  const payload = JSON.stringify({ id: id ?? "", version, config: JSON.stringify(stored) });
  const result = id
    ? await call<{ carousel: CarouselSummary }>(`/carousels/${id}`, { method: "PUT", body: payload })
    : await call<{ carousel: CarouselSummary }>("/carousels", { method: "POST", body: payload });
  return result.carousel;
}

export async function loadCarousel(id: string) {
  const { carousel } = await call<{ carousel: CarouselSummary & { config: string } }>(`/carousels/${id}`);
  return { summary: carousel, config: JSON.parse(carousel.config) as CarouselConfig };
}
