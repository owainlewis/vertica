/** The JSON API. Mounted under /api; the same routes the client has always called. */
import { Hono } from "hono";
import { videoRoutes } from "./video.ts";
import { SUPPORTED_IMAGE_MIME_TYPES } from "../app/image-formats.ts";
import { clearSessionCookie, createSessionCookie, isAuthorised, isSecureRequest, passwordMatches } from "./auth.ts";
import type { Bucket } from "./bucket.ts";
import {
  ConflictError,
  deleteCarousel,
  getCarousel,
  getMedia,
  isMediaKey,
  listCarousels,
  listMediaAssets,
  MissingError,
  putMedia,
  removeMediaAsset,
  saveCarousel,
} from "./store.ts";

/** Thrown for input the caller can fix. Anything else is ours and stays generic. */
class InvalidInput extends Error {}

const MAX_CONFIG_BYTES = 400_000;
const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const DATA_URL = new RegExp(
  `^data:(${SUPPORTED_IMAGE_MIME_TYPES.map((type) => type.replace("/", "\\/")).join("|")});base64,([a-z0-9+/=\\s]+)$`,
  "i",
);

/** Mirrors the client's parser closely enough to keep junk out of the bucket. */
function readInput(body: unknown) {
  if (!body || typeof body !== "object") throw new InvalidInput("Expected a carousel object.");
  const record = body as Record<string, unknown>;

  const config = record.config;
  if (typeof config !== "string" || !config) throw new InvalidInput("The carousel config is missing.");
  if (config.length > MAX_CONFIG_BYTES) {
    throw new InvalidInput("This carousel is too large to save. Images belong in the media library, not the config.");
  }

  let parsed: { title?: unknown; author?: unknown; mark?: unknown; slides?: unknown };
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

  return {
    version,
    input: {
      id: typeof record.id === "string" && /^[\w-]{1,200}$/.test(record.id) ? record.id : "",
      title: text(parsed.title, "Untitled carousel"),
      author: text(parsed.author, ""),
      slideCount: slides.length,
      coverTitle: text(cover?.title, ""),
      // The gallery renders the real first slide rather than an approximation of it.
      cover: JSON.stringify({
        slide: cover ?? {},
        mark: typeof parsed.mark === "string" ? parsed.mark.slice(0, 30) : "",
      }),
      config,
    },
  };
}

/** Decodes an image data URL without trusting its declared size. */
function readDataUrl(text: string) {
  const match = text.match(DATA_URL);
  if (!match) throw new InvalidInput("Only PNG, JPEG, GIF, AVIF, and WebP images can be stored.");
  let binary: string;
  try {
    binary = atob(match[2].replace(/\s/g, ""));
  } catch {
    throw new InvalidInput("That image data is not valid base64.");
  }
  if (binary.length > MAX_MEDIA_BYTES) throw new InvalidInput("That image is too large. Keep images under 12MB.");
  return { mimeType: match[1].toLowerCase(), bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)) };
}

function header(request: Request, name: string, maxLength: number) {
  const value = request.headers.get(name);
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim().slice(0, maxLength);
  } catch {
    return "";
  }
}

function dimension(request: Request, name: string) {
  const value = Number(request.headers.get(name));
  return Number.isInteger(value) && value > 0 && value <= 20_000 ? value : null;
}

export type ApiOptions = { bucket: Bucket; secret?: string };

export function createApi({ bucket, secret }: ApiOptions) {
  const api = new Hono();

  api.get("/session", async (c) => c.json({ gated: Boolean(secret), authorised: await isAuthorised(c.req.raw, secret) }));
  api.post("/session", async (c) => {
    if (!secret) return c.json({ ok: true, gated: false });
    const body = await c.req.json().catch(() => null);
    if (!(await passwordMatches((body as Record<string, unknown> | null)?.password, secret))) {
      return c.json({ error: "That password is not right." }, 401);
    }
    c.header("set-cookie", await createSessionCookie(secret, isSecureRequest(c.req.raw)));
    return c.json({ ok: true });
  });
  api.delete("/session", (c) => {
    c.header("set-cookie", clearSessionCookie(isSecureRequest(c.req.raw)));
    return c.json({ ok: true });
  });

  api.use("*", async (c, next) => {
    if (!(await isAuthorised(c.req.raw, secret))) return c.json({ error: "Sign in to manage carousels." }, 401);
    await next();
  });

  api.get("/media", async (c) => c.json({ media: await listMediaAssets(bucket), nextCursor: null }));

  api.route("/", videoRoutes(bucket));

  api.put("/media/:key", async (c) => {
    const key = c.req.param("key");
    if (!isMediaKey(key)) return c.json({ error: "That image key is invalid." }, 400);
    const length = Number(c.req.header("content-length"));
    if (Number.isFinite(length) && length > MAX_MEDIA_BYTES * 1.4) {
      return c.json({ error: "That image is too large. Keep images under 12MB." }, 400);
    }
    const { bytes, mimeType } = readDataUrl(await c.req.text());
    const library = c.req.header("x-media-library") === "1"
      ? { name: header(c.req.raw, "x-media-name", 180) || "Untitled image", width: dimension(c.req.raw, "x-media-width"), height: dimension(c.req.raw, "x-media-height") }
      : undefined;
    await putMedia(bucket, key, { bytes, mimeType, library });
    return c.json({ ok: true, key });
  });

  api.get("/media/:key", async (c) => {
    const key = c.req.param("key");
    if (!isMediaKey(key)) return c.json({ error: "That image key is invalid." }, 400);
    const object = await getMedia(bucket, key);
    if (!object) return c.json({ error: "That image is gone." }, 404);
    return new Response(new Blob([object.bytes as BlobPart]), {
      headers: { "content-type": object.meta.contentType, "cache-control": "private, max-age=31536000, immutable" },
    });
  });

  api.delete("/media/:key", async (c) => {
    const key = c.req.param("key");
    if (!isMediaKey(key)) return c.json({ error: "That image key is invalid." }, 400);
    const result = await removeMediaAsset(bucket, key);
    if (result === "missing") return c.json({ error: "That image is not in your media library." }, 404);
    if (result === "in-use") {
      return c.json({ error: "This image is used by a carousel. Remove it from every slide before deleting it." }, 409);
    }
    return c.json({ ok: true });
  });

  api.get("/carousels", async (c) => c.json({ carousels: await listCarousels(bucket) }));

  api.post("/carousels", async (c) => {
    const { input } = readInput(await c.req.json().catch(() => null));
    const carousel = await saveCarousel(bucket, { ...input, id: input.id || crypto.randomUUID() }, null);
    return c.json({ carousel }, 201);
  });

  api.get("/carousels/:id", async (c) => {
    const carousel = await getCarousel(bucket, c.req.param("id"));
    return carousel ? c.json({ carousel }) : c.json({ error: "That carousel is gone." }, 404);
  });

  api.put("/carousels/:id", async (c) => {
    const { input, version } = readInput(await c.req.json().catch(() => null));
    if (version === null) return c.json({ error: "This save is missing its version. Reload the page." }, 409);
    const carousel = await saveCarousel(bucket, { ...input, id: c.req.param("id") }, version);
    return c.json({ carousel });
  });

  api.delete("/carousels/:id", async (c) => {
    await deleteCarousel(bucket, c.req.param("id"));
    return c.json({ ok: true });
  });

  api.notFound((c) => c.json({ error: "No such endpoint." }, 404));

  api.onError((error, c) => {
    // A stale write is not a bad request: the client is well formed but out of date.
    if (error instanceof ConflictError) return c.json({ error: error.message }, 409);
    if (error instanceof MissingError) return c.json({ error: error.message }, 404);
    if (error instanceof InvalidInput) return c.json({ error: error.message }, 400);
    // Anything else is a fault on our side. Its message may carry internals, so it is
    // logged rather than returned.
    console.error("request failed", error);
    return c.json({ error: "Something went wrong." }, 500);
  });

  return api;
}
