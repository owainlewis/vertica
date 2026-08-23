/** JSON API for saved carousels. Mounted under /api by the worker entry point. */
import { clearSessionCookie, createSessionCookie, isAuthorised, isSecureRequest, passwordMatches } from "./auth.ts";
import { ConflictError, deleteCarousel, getCarousel, listCarousels, MissingError, saveCarousel, type D1Database } from "./db.ts";
import { getMedia, InvalidMediaInput, isMediaKey, putMedia, readMediaRequest, type R2Bucket } from "./media.ts";

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
        await putMedia(env.MEDIA, key, await readMediaRequest(request));
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
      return json({ error: "Method not allowed." }, { status: 405 });
    }

    if (path === "/carousels" && request.method === "GET") {
      return json({ carousels: await listCarousels(db) });
    }

    if (path === "/carousels" && request.method === "POST") {
      const { input } = readInput(await request.json().catch(() => null));
      return json({ carousel: await saveCarousel(db, { ...input, id: input.id || newId() }, null) }, { status: 201 });
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
          return json({ error: "This save is missing its version. Reload the page." }, { status: 409 });
        }
        return json({ carousel: await saveCarousel(db, { ...input, id }, version) });
      }
      if (request.method === "DELETE") {
        await deleteCarousel(db, id);
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
