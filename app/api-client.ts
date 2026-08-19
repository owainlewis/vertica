"use client";

import type { CarouselConfig } from "./carousel";
import { isImageKey, loadImages, putImage } from "./image-store";

export type CarouselSummary = {
  id: string;
  title: string;
  author: string;
  template: string;
  slideCount: number;
  coverTitle: string;
  cover: string;
  /** Bumped on every write. Send the last one read back, or the save is refused. */
  version: number;
  createdAt: string;
  updatedAt: string;
};

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

export function signOut() {
  return call<{ ok: true }>("/session", { method: "DELETE" });
}

export async function listCarousels() {
  return (await call<{ carousels: CarouselSummary[] }>("/carousels")).carousels;
}

export function deleteCarousel(id: string) {
  return call<{ ok: true }>(`/carousels/${id}`, { method: "DELETE" });
}

/**
 * Moves any freshly uploaded image bytes into the image store, so what reaches the
 * database is keys. Slides that already carry a key are left alone.
 */
async function externaliseBackgrounds(config: CarouselConfig): Promise<CarouselConfig> {
  const slides = await Promise.all(
    config.slides.map(async (slide) => {
      if (!slide.background || isImageKey(slide.background)) return slide;
      return { ...slide, background: await putImage(slide.background) };
    }),
  );
  return { ...config, slides };
}

/**
 * Resolves stored keys back into data URLs the slide renderer can paint.
 *
 * A key with no bytes behind it means the image lives in another browser, or that
 * this one has evicted its store. The key is kept exactly as it was. Replacing it
 * with undefined is what used to destroy data: the editor would hold the stripped
 * config, autosave on the next keystroke, and write a deck with no image references
 * at all over the one in the database, leaving the bytes in the original browser with
 * nothing pointing at them. The renderer paints data URLs only, so an unresolved key
 * shows nothing and saves back unharmed.
 */
export async function inlineBackgrounds(config: CarouselConfig): Promise<CarouselConfig> {
  const images = await loadImages(config.slides.map((slide) => slide.background ?? ""));
  return {
    ...config,
    slides: config.slides.map((slide) => {
      if (!isImageKey(slide.background)) return slide;
      const data = images[slide.background];
      return data ? { ...slide, background: data } : slide;
    }),
  };
}

/** True when a slide points at an image this browser cannot show. */
export function hasMissingImage(config: CarouselConfig) {
  return config.slides.some((slide) => isImageKey(slide.background));
}

export async function saveCarousel(id: string | null, config: CarouselConfig, version: number | null) {
  const stored = await externaliseBackgrounds(config);
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
