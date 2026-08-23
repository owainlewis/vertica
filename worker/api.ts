/** JSON API for saved carousels. Mounted under /api by the worker entry point. */
import { clearSessionCookie, createSessionCookie, isAuthorised, isSecureRequest, passwordMatches } from "./auth.ts";
import {
  ConflictError,
  claimMediaCleanup,
  deleteCarousel,
  finishMediaCleanup,
  getCarousel,
  isMediaReferenced,
  listCarousels,
  listMediaCleanup,
  listMediaAssets,
  MissingError,
  postponeMediaCleanup,
  protectMedia,
  queueMediaCleanup,
  releaseMediaCleanup,
  removeMediaAsset,
  saveCarousel,
  unqueueMediaCleanup,
  upsertMediaAsset,
  type D1Database,
} from "./db.ts";
import { deleteMedia, getMedia, InvalidMediaInput, isMediaKey, putMedia, readMediaRequest, type R2Bucket } from "./media.ts";

/** Thrown for input the caller can fix. Anything else is ours and stays generic. */
class InvalidInput extends Error {}

export interface ApiEnv {
  DB?: D1Database;
  APP_SECRET?: string;
  MEDIA?: R2Bucket;
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
  });
}

const MAX_CONFIG_BYTES = 400_000;

function mediaKeys(config: string) {
  try {
    const parsed = JSON.parse(config) as { slides?: Array<{ background?: unknown }> };
    return [...new Set((parsed.slides ?? [])
      .map((slide) => slide?.background)
      .filter((value): value is string => typeof value === "string" && isMediaKey(value)))];
  } catch {
    return [];
  }
}

async function collectMediaGarbage(db: D1Database, bucket: R2Bucket, candidates: string[] = []) {
  await queueMediaCleanup(db, candidates);
  for (const { key, notBefore } of await listMediaCleanup(db)) {
    const claim = crypto.randomUUID();
    if (!(await claimMediaCleanup(db, key, notBefore, claim))) continue;
    try {
      if (await isMediaReferenced(db, key)) {
        await postponeMediaCleanup(db, key, claim);
      } else {
        await deleteMedia(bucket, key);
        await finishMediaCleanup(db, key, notBefore, claim);
      }
    } catch (error) {
      await releaseMediaCleanup(db, key, claim).catch(() => undefined);
      throw error;
    }
  }
}

async function protectMediaForSave(
  db: D1Database,
  bucket: R2Bucket | undefined,
  keys: string[],
  adoptedKeys: string[] = [],
) {
  const waited = await protectMedia(db, keys);
  const verify = [...new Set([...waited, ...adoptedKeys])];
  if (!verify.length) return;
  if (!bucket) throw new InvalidInput("Media persistence is not configured.");
  for (const key of verify) {
    const object = await getMedia(bucket, key);
    if (!object) {
      throw new InvalidInput("An image was removed while this carousel was saving. Add it again and retry.");
    }
    await object.body.cancel().catch(() => undefined);
  }
}

async function tryCollectMediaGarbage(db: D1Database, bucket: R2Bucket | undefined, candidates: string[] = []) {
  if (!bucket) return;
  try {
    await collectMediaGarbage(db, bucket, candidates);
  } catch (error) {
    console.error("media cleanup failed", error);
  }
}

/** Mirrors the client's parser closely enough to keep junk out of the table. */
function readInput(body: unknown) {
  if (!body || typeof body !== "object") throw new InvalidInput("Expected a carousel object.");
  const record = body as Record<string, unknown>;

  const config = record.config;
  if (typeof config !== "string" || !config) throw new InvalidInput("The carousel config is missing.");
  if (config.length > MAX_CONFIG_BYTES) {
    throw new InvalidInput("This carousel is too large to save. Background images belong in the image store, not the config.");
  }

  let parsed: { title?: unknown; author?: unknown; template?: unknown; mark?: unknown; slides?: unknown };
  try {
    parsed = JSON.parse(config);
  } catch {
    throw new InvalidInput("The carousel config is not valid JSON.");
  }

  const slides = Array.isArray(parsed.slides) ? parsed.slides : [];
  if (!slides.length) throw new InvalidInput("A carousel needs at least one slide.");

  const cover = slides[0] as Record<string, unknown> | undefined;
  const text = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : fallback;

  // The version the client last read. Absent means the client is not tracking one,
  // which only a brand new carousel should be doing.
  const version = typeof record.version === "number" && Number.isInteger(record.version) && record.version > 0
    ? record.version
    : null;

  const input = {
    id: text(record.id, ""),
    title: text(parsed.title, "Untitled carousel"),
    author: text(parsed.author, ""),
    template: text(parsed.template, "dark"),
    slideCount: slides.length,
    coverTitle: text(cover?.title, ""),
    // The gallery renders the real first slide rather than an approximation of it.
    // Typography is a fixed design-system value, so no deck-wide scale is persisted.
    cover: JSON.stringify({
      slide: cover ?? {},
      mark: typeof parsed.mark === "string" ? parsed.mark.slice(0, 30) : "",
    }),
    config,
  };

  return { input, version };
}

function newId() {
  return crypto.randomUUID();
}

function mediaHeader(request: Request, name: string, maxLength: number) {
  const value = request.headers.get(name);
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim().slice(0, maxLength);
  } catch {
    return "";
  }
}

function mediaDimension(request: Request, name: string) {
  const value = Number(request.headers.get(name));
  return Number.isInteger(value) && value > 0 && value <= 20_000 ? value : null;
}

export async function handleApi(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const secret = env.APP_SECRET;

  if (path === "/session") {
    if (request.method === "POST") {
      if (!secret) return json({ ok: true, gated: false });
      const body = await request.json().catch(() => null);
      if (!(await passwordMatches((body as Record<string, unknown> | null)?.password, secret))) {
        return json({ error: "That password is not right." }, { status: 401 });
      }
      const cookie = await createSessionCookie(secret, isSecureRequest(request));
      return json({ ok: true }, { headers: { "set-cookie": cookie } });
    }
    if (request.method === "DELETE") {
      return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(isSecureRequest(request)) } });
    }
    if (request.method === "GET") {
      return json({ gated: Boolean(secret), authorised: await isAuthorised(request, secret) });
    }
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  if (!(await isAuthorised(request, secret))) {
    return json({ error: "Sign in to manage carousels." }, { status: 401 });
  }

  const db = env.DB;
  if (!db) {
    return json({ error: "No database is bound. Set \"d1\" in .openai/hosting.json and restart." }, { status: 503 });
  }

  try {
    if (path === "/media" && request.method === "GET") {
      await tryCollectMediaGarbage(db, env.MEDIA);
      const page = await listMediaAssets(db, url.searchParams.get("cursor"));
      return json({ media: page.items, nextCursor: page.nextCursor });
    }

    const mediaMatch = path.match(/^\/media\/(.+)$/);
    if (mediaMatch) {
      let key = "";
      try {
        key = decodeURIComponent(mediaMatch[1]);
      } catch {
        return json({ error: "That image key is invalid." }, { status: 400 });
      }
      if (!isMediaKey(key)) return json({ error: "That image key is invalid." }, { status: 400 });
      if (!env.MEDIA) return json({ error: "Media persistence is not configured." }, { status: 503 });

      if (request.method === "PUT") {
        // Refresh before and after the R2 write. The first refresh protects a reused
        // content hash from a matured collector; the second starts a full grace period
        // for abandoned uploads after the bytes are durable.
        await protectMedia(db, [key]);
        const stored = await putMedia(env.MEDIA, key, await readMediaRequest(request));
        await protectMedia(db, [key]);
        if (request.headers.get("x-media-library") === "1") {
          if (stored.mimeType === "image/svg+xml") {
            throw new InvalidMediaInput("SVG images cannot be added to the media library.");
          }
          await upsertMediaAsset(db, {
            key,
            kind: "image",
            name: mediaHeader(request, "x-media-name", 180) || "Untitled image",
            mimeType: stored.mimeType,
            width: mediaDimension(request, "x-media-width"),
            height: mediaDimension(request, "x-media-height"),
            byteSize: stored.byteSize,
          });
          await unqueueMediaCleanup(db, key);
        }
        return json({ ok: true, key });
      }
      if (request.method === "GET") {
        const object = await getMedia(env.MEDIA, key);
        if (!object) return json({ error: "That image is gone." }, { status: 404 });
        return new Response(object.body, {
          headers: {
            "cache-control": object.httpMetadata?.cacheControl ?? "private, max-age=31536000, immutable",
            "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
          },
        });
      }
      if (request.method === "DELETE") {
        const result = await removeMediaAsset(db, key);
        if (result === "missing") return json({ error: "That image is not in your media library." }, { status: 404 });
        if (result === "in-use") {
          return json({ error: "This image is used by a carousel. Remove it from every slide before deleting it." }, { status: 409 });
        }
        await tryCollectMediaGarbage(db, env.MEDIA, [key]);
        return json({ ok: true });
      }
      return json({ error: "Method not allowed." }, { status: 405 });
    }

    if (path === "/carousels" && request.method === "GET") {
      await tryCollectMediaGarbage(db, env.MEDIA);
      return json({ carousels: await listCarousels(db) });
    }

    if (path === "/carousels" && request.method === "POST") {
      const { input } = readInput(await request.json().catch(() => null));
      const keys = mediaKeys(input.config);
      await protectMediaForSave(db, env.MEDIA, keys, keys);
      try {
        const carousel = await saveCarousel(db, { ...input, id: input.id || newId() }, null);
        await tryCollectMediaGarbage(db, env.MEDIA);
        return json({ carousel }, { status: 201 });
      } catch (error) {
        await tryCollectMediaGarbage(db, env.MEDIA, mediaKeys(input.config));
        throw error;
      }
    }

    const match = path.match(/^\/carousels\/([\w-]+)$/);
    if (match) {
      const id = match[1];

      if (request.method === "GET") {
        const carousel = await getCarousel(db, id);
        return carousel ? json({ carousel }) : json({ error: "That carousel is gone." }, { status: 404 });
      }
      if (request.method === "PUT") {
        const { input, version } = readInput(await request.json().catch(() => null));
        if (version === null) {
          await tryCollectMediaGarbage(db, env.MEDIA, mediaKeys(input.config));
          return json({ error: "This save is missing its version. Reload the page." }, { status: 409 });
        }
        const previous = await getCarousel(db, id);
        const keys = mediaKeys(input.config);
        const previousKeys = new Set(mediaKeys(previous?.config ?? ""));
        const adopted = keys.filter((key) => !previousKeys.has(key));
        // Refresh before the config write and verify newly adopted keys. Existing
        // keys avoid an R2 read on every text-only autosave.
        await protectMediaForSave(db, env.MEDIA, keys, adopted);
        try {
          const carousel = await saveCarousel(db, { ...input, id }, version);
          const retained = new Set(keys);
          const removed = mediaKeys(previous?.config ?? "").filter((key) => !retained.has(key));
          await tryCollectMediaGarbage(db, env.MEDIA, removed);
          return json({ carousel });
        } catch (error) {
          // Media is uploaded before the config write. A conflict or failed save can
          // therefore leave new keys unreferenced; queue them for a safe later sweep.
          await tryCollectMediaGarbage(db, env.MEDIA, mediaKeys(input.config));
          throw error;
        }
      }
      if (request.method === "DELETE") {
        const previous = await getCarousel(db, id);
        await deleteCarousel(db, id);
        await tryCollectMediaGarbage(db, env.MEDIA, mediaKeys(previous?.config ?? ""));
        return json({ ok: true });
      }
    }

    return json({ error: "No such endpoint." }, { status: 404 });
  } catch (error) {
    // A stale write is not a bad request: the client is well formed but out of date,
    // and the only fix is to reload rather than to correct the payload.
    if (error instanceof ConflictError) return json({ error: error.message }, { status: 409 });
    if (error instanceof MissingError) return json({ error: error.message }, { status: 404 });
    if (error instanceof InvalidMediaInput) return json({ error: error.message }, { status: 400 });
    if (error instanceof InvalidInput) return json({ error: error.message }, { status: 400 });
    // Anything else is a fault on our side. Its message can carry database internals,
    // so it is logged rather than returned.
    console.error("carousel request failed", error);
    return json({ error: "Something went wrong saving that carousel." }, { status: 500 });
  }
}
