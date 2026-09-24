/** Image rules shared by the browser and the API, so both refuse the same input. */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const SUPPORTED_IMAGE_ACCEPT = SUPPORTED_IMAGE_MIME_TYPES.join(",");

/** A stored image is referred to by `img:<content hash>` rather than by its bytes. */
export const IMAGE_KEY_PREFIX = "img:";

export function isImageKey(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(IMAGE_KEY_PREFIX);
}

const IMAGE_DATA_URL = new RegExp(
  `^data:(${SUPPORTED_IMAGE_MIME_TYPES.map((type) => type.replace("/", "\\/")).join("|")});base64,([a-z0-9+/=\\s]+)$`,
  "i",
);

/** Splits a supported image data URL into its type and base64 payload. */
export function matchImageDataUrl(value: string) {
  const match = IMAGE_DATA_URL.exec(value);
  return match ? { mimeType: match[1].toLowerCase(), base64: match[2] } : null;
}

export function isSupportedImageDataUrl(value: string) {
  return IMAGE_DATA_URL.test(value);
}
