/** R2-backed image bytes for carousel backgrounds. */

import { SUPPORTED_IMAGE_MIME_TYPES } from "../app/image-formats.ts";

export type MediaHttpMetadata = {
  contentType?: string;
  cacheControl?: string;
};

export type R2ObjectBody = {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: MediaHttpMetadata;
};

export type R2Bucket = {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: MediaHttpMetadata }): Promise<void>;
  delete(key: string): Promise<void>;
};

export class InvalidMediaInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMediaInput";
  }
}

const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const MAX_DATA_URL_BYTES = 4 * Math.ceil(MAX_MEDIA_BYTES / 3) + 64;
const MEDIA_KEY = /^img:[a-f0-9]{32}$/;
// SVG is accepted only at this storage boundary so carousels created before the
// upload picker was tightened remain saveable. New uploads still use the raster-only
// list in image-formats.ts.
const STORED_MEDIA_MIME_TYPES = [...SUPPORTED_IMAGE_MIME_TYPES, "image/svg+xml"];
const DATA_URL = new RegExp(
  `^data:(${STORED_MEDIA_MIME_TYPES.map((type) => type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")});base64,([a-z0-9+/=\\s]+)$`,
  "i",
);

export function isMediaKey(value: string) {
  return MEDIA_KEY.test(value);
}

/** Reads an image data URL without allowing an unbounded request body into memory. */
export async function readMediaRequest(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DATA_URL_BYTES) {
    throw new InvalidMediaInput("That image is too large. Keep images under 12MB.");
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_DATA_URL_BYTES) {
        throw new InvalidMediaInput("That image is too large. Keep images under 12MB.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function objectKey(key: string) {
  return `images/${key.slice(4)}`;
}

export async function putMedia(bucket: R2Bucket, key: string, dataUrl: string) {
  if (!isMediaKey(key)) throw new InvalidMediaInput("That image key is invalid.");
  const match = dataUrl.match(DATA_URL);
  if (!match) throw new InvalidMediaInput("Only PNG, JPEG, GIF, AVIF, WebP, and legacy SVG images can be stored.");

  let binary: string;
  try {
    binary = atob(match[2].replace(/\s/g, ""));
  } catch {
    throw new InvalidMediaInput("That image data is not valid base64.");
  }
  if (binary.length > MAX_MEDIA_BYTES) throw new InvalidMediaInput("That image is too large. Keep images under 12MB.");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  await bucket.put(objectKey(key), bytes.buffer, {
    httpMetadata: {
      contentType: match[1].toLowerCase(),
      cacheControl: "private, max-age=31536000, immutable",
    },
  });
  return { mimeType: match[1].toLowerCase(), byteSize: bytes.byteLength };
}

export function getMedia(bucket: R2Bucket, key: string) {
  if (!isMediaKey(key)) return Promise.resolve(null);
  return bucket.get(objectKey(key));
}

export function deleteMedia(bucket: R2Bucket, key: string) {
  if (!isMediaKey(key)) return Promise.resolve();
  return bucket.delete(objectKey(key));
}
