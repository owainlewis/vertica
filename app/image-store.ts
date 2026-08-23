"use client";

/**
 * Background images use a content hash as their stable key. IndexedDB remains a
 * local cache, while the API stores the bytes in R2 so a saved carousel can resolve
 * its images in another browser. The rest of the app still deals in keys, not bytes.
 */

const DB_NAME = "vertica-images";
const STORE = "images";
export const IMAGE_PREFIX = "img:";
// A data URL can re-enter putImage on every autosave because the editor resolves
// stored keys for painting. One successful PUT per key is enough for this session;
// cache-only legacy images still get that first PUT so they migrate to durable media.
const persistedKeys = new Set<string>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the image store."));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = work(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("The image store failed."));
      }),
  );
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stores a data URL and returns the key to keep in the carousel config. */
export async function putImage(dataUrl: string) {
  const key = `${IMAGE_PREFIX}${await hash(dataUrl)}`;
  if (persistedKeys.has(key)) return key;
  // IndexedDB is only a cache. Private browsing and restrictive browser policies
  // can disable it, but durable R2 storage must still remain usable.
  await run("readwrite", (store) => store.put(dataUrl, key)).catch(() => undefined);

  const response = await fetch(`/api/media/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: dataUrl,
  });
  // Do not report a carousel as saved when its bytes never reached durable storage.
  // A missing R2 binding is a configuration error, not permission to fall back to
  // browser-only media again.
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Could not persist that image.");
  }
  persistedKeys.add(key);
  return key;
}

export function isImageKey(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith(IMAGE_PREFIX);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the stored image."));
    reader.readAsDataURL(blob);
  });
}

async function loadRemoteImage(key: string) {
  try {
    const response = await fetch(`/api/media/${encodeURIComponent(key)}`);
    if (!response.ok) return undefined;
    persistedKeys.add(key);
    return await blobToDataUrl(await response.blob());
  } catch {
    // A missing optional R2 binding or a temporarily unavailable media request
    // should leave the key intact and let the existing missing-image warning win.
    return undefined;
  }
}

/** Resolves keys back to data URLs, checking the local cache before R2. */
export async function loadImages(keys: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(keys.filter(isImageKey))];
  if (!unique.length) return {};

  const entries = await Promise.all(
    unique.map(async (key) => {
      const local = await run<string | undefined>("readonly", (store) => store.get(key)).catch(() => undefined);
      if (local) return [key, local] as const;

      const value = await loadRemoteImage(key);
      if (value) {
        // Warm the local cache after a cross-browser load so subsequent previews
        // do not need another media request.
        await run("readwrite", (store) => store.put(value, key)).catch(() => undefined);
      }
      return [key, value] as const;
    }),
  );

  return Object.fromEntries(entries.filter(([, value]) => typeof value === "string")) as Record<string, string>;
}
