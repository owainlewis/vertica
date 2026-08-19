"use client";

/**
 * Background images live in the browser's IndexedDB, keyed by a content hash, and
 * the saved carousel stores only those keys. Two reasons: D1 caps a single value at
 * 1MB, which a real photograph blows straight through, and the same photo reused
 * across slides is then stored once.
 *
 * This is the seam to swap when the images move to Google Cloud. Reimplement
 * putImage and loadImages against a signed-upload endpoint and nothing else in the
 * app has to change: everywhere else already deals in keys, not bytes.
 */

const DB_NAME = "vertica-images";
const STORE = "images";
export const IMAGE_PREFIX = "img:";

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
  await run("readwrite", (store) => store.put(dataUrl, key));
  return key;
}

export function isImageKey(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith(IMAGE_PREFIX);
}

/** Resolves keys back to data URLs. Missing keys are simply absent from the map. */
export async function loadImages(keys: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(keys.filter(isImageKey))];
  if (!unique.length) return {};

  const entries = await Promise.all(
    unique.map(async (key) => {
      const value = await run<string | undefined>("readonly", (store) => store.get(key));
      return [key, value] as const;
    }),
  );

  return Object.fromEntries(entries.filter(([, value]) => typeof value === "string")) as Record<string, string>;
}
