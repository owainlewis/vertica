import { SUPPORTED_IMAGE_MIME_TYPES } from "./image-formats";

const MAX_IMAGE_EDGE = 2160;
const IMAGE_QUALITY = 0.86;

export type PreparedImage = {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
};

function blobToDataUrl(blob: Blob, fileName: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${fileName}.`));
    reader.readAsDataURL(blob);
  });
}

async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`Could not prepare ${file.name}.`);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error(`Could not prepare ${file.name}.`)),
        "image/webp",
        IMAGE_QUALITY,
      );
    });
    return {
      dataUrl: await blobToDataUrl(blob, file.name),
      name: file.name.replace(/\.[^.]+$/, "").trim() || "Untitled image",
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    bitmap.close();
  }
}

export function prepareImages(files: FileList | File[]) {
  const supportedTypes = new Set<string>(SUPPORTED_IMAGE_MIME_TYPES);
  return Promise.all(Array.from(files)
    .filter((file) => supportedTypes.has(file.type.toLowerCase()))
    .map(prepareImage));
}
