/** JSON API for saved carousels. Mounted under /api by the worker entry point. */
import { deckTypeScale, type CarouselSlide } from "../app/carousel.ts";
import { clearSessionCookie, createSessionCookie, isAuthorised, passwordMatches } from "./auth.ts";
import { ConflictError, deleteCarousel, getCarousel, listCarousels, saveCarousel, type D1Database } from "./db.ts";

export interface ApiEnv {
  DB?: D1Database;
  APP_SECRET?: string;
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
  if (!body || typeof body !== "object") throw new Error("Expected a carousel object.");
  const record = body as Record<string, unknown>;

  const config = record.config;
  if (typeof config !== "string" || !config) throw new Error("The carousel config is missing.");
  if (config.length > MAX_CONFIG_BYTES) {
    throw new Error("This carousel is too large to save. Background images belong in the image store, not the config.");
  }

  let parsed: { title?: unknown; author?: unknown; template?: unknown; slides?: unknown };
  try {
    parsed = JSON.parse(config);
  } catch {
    throw new Error("The carousel config is not valid JSON.");
  }

  const slides = Array.isArray(parsed.slides) ? parsed.slides : [];
  if (!slides.length) throw new Error("A carousel needs at least one slide.");

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
    template: text(parsed.template, "cinematic"),
    slideCount: slides.length,
    coverTitle: text(cover?.title, ""),
    // The gallery renders the real first slide rather than an approximation of it, so
    // it needs that slide verbatim plus the deck-wide type scale. Without the scale it
    // would size the title from one slide, and a deck whose first slide is not its
    // longest would render larger on the card than in the editor.
    cover: JSON.stringify({ slide: cover ?? {}, scale: deckTypeScale(slides as CarouselSlide[]) }),
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
      if (!passwordMatches((body as Record<string, unknown> | null)?.password, secret)) {
        return json({ error: "That password is not right." }, { status: 401 });
      }
      return json({ ok: true }, { headers: { "set-cookie": await createSessionCookie(secret) } });
    }
    if (request.method === "DELETE") {
      return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
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
    const message = error instanceof Error ? error.message : "Something went wrong.";
    // A stale write is not a bad request: the client is well formed but out of date,
    // and the only fix is to reload rather than to correct the payload.
    return json({ error: message }, { status: error instanceof ConflictError ? 409 : 400 });
  }
}
