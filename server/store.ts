/**
 * Decks and media as objects. A deck is `carousels/<id>.json` with its gallery
 * summary in the object's metadata, so listing the gallery never downloads a
 * document. Its version is the object's generation. Media is `media/<hash>`, with
 * the library entry's name and size in the same place.
 */
import type { Bucket, ObjectMeta } from "./bucket.ts";
import { PreconditionError } from "./bucket.ts";

export type CarouselSummary = {
  id: string;
  title: string;
  author: string;
  slideCount: number;
  coverTitle: string;
  /** The first slide and the deck's mark, verbatim, so the gallery draws a true miniature. */
  cover: string;
  /** The object generation. A client must send back the one it last read. */
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CarouselRecord = CarouselSummary & { config: string };

export type MediaAsset = {
  key: string;
  kind: "image";
  name: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  createdAt: string;
  updatedAt: string;
};

export class MissingError extends Error {
  constructor() {
    super("That carousel is gone.");
    this.name = "MissingError";
  }
}

export class ConflictError extends Error {
  constructor() {
    super("This carousel was changed somewhere else. Reload the page to get the newer version.");
    this.name = "ConflictError";
  }
}

const CAROUSELS = "carousels/";
const MEDIA = "media/";
const MEDIA_KEY = /^img:[a-f0-9]{32}$/;
/** Object metadata is capped at a few kilobytes, so a cover carrying a diagram is trimmed. */
const MAX_COVER_CHARS = 4000;

export function isMediaKey(value: string) {
  return MEDIA_KEY.test(value);
}

function carouselKey(id: string) {
  return `${CAROUSELS}${id}.json`;
}

function mediaObjectKey(key: string) {
  return `${MEDIA}${key.slice(4)}`;
}

/** Every media key a config refers to: backgrounds, pictures and the avatar. */
export function mediaKeysIn(config: string) {
  try {
    const parsed = JSON.parse(config) as { avatar?: unknown; slides?: Array<{ background?: unknown; images?: unknown }> };
    const refs = [parsed.avatar, ...(parsed.slides ?? []).flatMap((slide) => [
      slide?.background,
      ...(Array.isArray(slide?.images) ? slide.images : []),
    ])];
    return [...new Set(refs.filter((value): value is string => typeof value === "string" && isMediaKey(value)))];
  } catch {
    return [];
  }
}

function summaryOf(id: string, meta: ObjectMeta): CarouselSummary {
  return {
    id,
    title: meta.custom.title ?? "Untitled carousel",
    author: meta.custom.author ?? "",
    slideCount: Number(meta.custom.slideCount ?? 1),
    coverTitle: meta.custom.coverTitle ?? "",
    cover: meta.custom.cover ?? "",
    version: meta.generation,
    createdAt: meta.custom.createdAt ?? meta.updated,
    updatedAt: meta.updated,
  };
}

export async function listCarousels(bucket: Bucket): Promise<CarouselSummary[]> {
  const objects = await bucket.list(CAROUSELS);
  return objects
    .filter(({ key }) => key.endsWith(".json"))
    .map(({ key, meta }) => summaryOf(key.slice(CAROUSELS.length, -".json".length), meta))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 200);
}

export async function getCarousel(bucket: Bucket, id: string): Promise<CarouselRecord | null> {
  const object = await bucket.get(carouselKey(id));
  if (!object) return null;
  return { ...summaryOf(id, object.meta), config: new TextDecoder().decode(object.bytes) };
}

export type CarouselInput = {
  id: string;
  title: string;
  author: string;
  slideCount: number;
  coverTitle: string;
  cover: string;
  config: string;
};

/**
 * Writes a deck, guarded on the generation the client last read. A stale write is
 * refused rather than applied, so two editors on one deck cannot clobber each other.
 * `expectedVersion` of null means "this is new".
 */
export async function saveCarousel(bucket: Bucket, input: CarouselInput, expectedVersion: number | null): Promise<CarouselRecord> {
  const key = carouselKey(input.id);
  const existing = expectedVersion === null ? null : await bucket.head(key);
  if (expectedVersion !== null && !existing) throw new MissingError();

  const custom = {
    title: input.title,
    author: input.author,
    slideCount: String(input.slideCount),
    coverTitle: input.coverTitle,
    cover: input.cover.length > MAX_COVER_CHARS ? trimCover(input.cover) : input.cover,
    createdAt: existing?.custom.createdAt ?? new Date().toISOString(),
    mediaKeys: mediaKeysIn(input.config).join(","),
  };

  try {
    const meta = await bucket.put(key, new TextEncoder().encode(input.config), {
      contentType: "application/json",
      custom,
      ifGeneration: expectedVersion ?? 0,
    });
    return { ...summaryOf(input.id, meta), config: input.config };
  } catch (error) {
    if (error instanceof PreconditionError) throw new ConflictError();
    throw error;
  }
}

/** A cover slide that carries a big diagram keeps everything but the drawing. */
function trimCover(cover: string) {
  try {
    const parsed = JSON.parse(cover) as { slide?: Record<string, unknown> };
    if (parsed.slide) delete parsed.slide.diagram;
    return JSON.stringify(parsed).slice(0, MAX_COVER_CHARS);
  } catch {
    return "";
  }
}

export function deleteCarousel(bucket: Bucket, id: string) {
  return bucket.delete(carouselKey(id));
}

/** Which decks still refer to a media key. Reads metadata only. */
export async function mediaInUse(bucket: Bucket, key: string) {
  const objects = await bucket.list(CAROUSELS);
  return objects.some(({ meta }) => (meta.custom.mediaKeys ?? "").split(",").includes(key));
}

function assetOf(key: string, meta: ObjectMeta): MediaAsset {
  const number = (value: string | undefined) => (value && Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    key,
    kind: "image",
    name: meta.custom.name ?? "Untitled image",
    mimeType: meta.contentType,
    width: number(meta.custom.width),
    height: number(meta.custom.height),
    byteSize: number(meta.custom.byteSize),
    createdAt: meta.custom.createdAt ?? meta.updated,
    updatedAt: meta.updated,
  };
}

/** Library items are media objects that were uploaded through the library. */
export async function listMediaAssets(bucket: Bucket): Promise<MediaAsset[]> {
  const objects = await bucket.list(MEDIA);
  return objects
    .filter(({ meta }) => meta.custom.library === "1")
    .map(({ key, meta }) => assetOf(`img:${key.slice(MEDIA.length)}`, meta))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export type MediaUpload = {
  bytes: Uint8Array;
  mimeType: string;
  /** Present when the upload should appear in the library. */
  library?: { name: string; width: number | null; height: number | null };
};

/**
 * Stores media bytes under their content hash. A key that already exists keeps
 * its bytes; only a library upload refreshes the entry's name and size.
 */
export async function putMedia(bucket: Bucket, key: string, upload: MediaUpload) {
  const objectKey = mediaObjectKey(key);
  const existing = await bucket.head(objectKey);
  if (existing && !upload.library) return;

  const custom: Record<string, string> = {
    ...(existing?.custom ?? {}),
    byteSize: String(upload.bytes.byteLength),
    createdAt: existing?.custom.createdAt ?? new Date().toISOString(),
  };
  if (upload.library) {
    custom.library = "1";
    custom.name = upload.library.name;
    if (upload.library.width) custom.width = String(upload.library.width);
    if (upload.library.height) custom.height = String(upload.library.height);
  }
  await bucket.put(objectKey, upload.bytes, { contentType: upload.mimeType, custom });
}

export function getMedia(bucket: Bucket, key: string) {
  return bucket.get(mediaObjectKey(key));
}

/** Removes a library item unless a deck still uses it. */
export async function removeMediaAsset(bucket: Bucket, key: string) {
  const objectKey = mediaObjectKey(key);
  const existing = await bucket.head(objectKey);
  if (!existing || existing.custom.library !== "1") return "missing" as const;
  if (await mediaInUse(bucket, key)) return "in-use" as const;
  await bucket.delete(objectKey);
  return "deleted" as const;
}
