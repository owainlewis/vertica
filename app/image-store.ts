/**
 * Images are stored under a content hash. The bucket behind the API is the durable
 * copy, so a saved carousel resolves its images in any browser; IndexedDB is only a
 * local cache in front of it. The rest of the app deals in keys, not bytes.
 */
import { blobToDataUrl } from "./data-url.ts";
import { IMAGE_KEY_PREFIX, isImageKey } from "./image-formats.ts";

const DB_NAME = "vertica-images";
const STORE = "images";
// A data URL can re-enter putImage on every autosave because the editor resolves
// stored keys for painting. One successful PUT per key is enough for this session;
// cache-only legacy images still get that first PUT so they migrate to durable media.
const persistedKeys = new Set<string>();
const pendingPuts = new Map<string, Promise<string>>();

export type ImageMetadata = {
  name: string;
  width: number;
  height: number;
};

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

export function mediaUrl(key: string) {
  return `/api/media/${encodeURIComponent(key)}`;
}

/** Stores a data URL and returns the key to keep in the carousel config. */
export async function putImage(dataUrl: string, metadata?: ImageMetadata) {
  const key = `${IMAGE_KEY_PREFIX}${await hash(dataUrl)}`;
  if (!metadata && persistedKeys.has(key)) return key;
  const requestKey = metadata ? `${key}:library` : key;
  const existing = pendingPuts.get(requestKey);
  if (existing) return existing;

  const pending = (async () => {
    // IndexedDB is only a cache. Private browsing and restrictive browser policies
    // can disable it, but the durable store must still remain usable.
    await run("readwrite", (store) => store.put(dataUrl, key)).catch(() => undefined);

    const response = await fetch(mediaUrl(key), {
      method: "PUT",
      headers: {
        "content-type": "text/plain",
        ...(metadata ? {
          "x-media-library": "1",
          "x-media-name": encodeURIComponent(metadata.name),
          "x-media-width": String(metadata.width),
          "x-media-height": String(metadata.height),
        } : {}),
      },
      body: dataUrl,
    });
    // Do not report a carousel as saved when its bytes never reached durable storage.
    // A broken media store is a configuration error, not permission to fall back to
    // browser-only media again.
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "Could not persist that image.");
    }
    persistedKeys.add(key);
    return key;
  })();

  pendingPuts.set(requestKey, pending);
  try {
    return await pending;
  } finally {
    if (pendingPuts.get(requestKey) === pending) pendingPuts.delete(requestKey);
  }
}

async function loadRemoteImage(key: string) {
  try {
    const response = await fetch(mediaUrl(key));
    if (!response.ok) return undefined;
    persistedKeys.add(key);
    return await blobToDataUrl(await response.blob(), "Could not read the stored image.");
  } catch {
    // A temporarily unavailable media request should leave the key intact and let
    // the existing missing-image warning win.
    return undefined;
  }
}

/** Resolves keys back to data URLs, checking the local cache before the API. */
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
