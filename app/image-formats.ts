export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const SUPPORTED_IMAGE_ACCEPT = SUPPORTED_IMAGE_MIME_TYPES.join(",");

const SUPPORTED_IMAGE_DATA_URL = new RegExp(
  `^data:(?:${SUPPORTED_IMAGE_MIME_TYPES.map((type) => type.replace("/", "\\/")).join("|")});base64,[a-z0-9+/=\\s]+$`,
  "i",
);

export function isSupportedImageDataUrl(value: string) {
  return SUPPORTED_IMAGE_DATA_URL.test(value);
}
