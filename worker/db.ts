/** Carousel storage on D1. One table, so plain SQL rather than an ORM. */
import { deckTypeScale, type CarouselSlide } from "../app/carousel.ts";

export interface D1Result<T> {
  results: T[];
}

export interface D1RunResult {
  meta?: { changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
  exec(query: string): Promise<unknown>;
}

/** A saved carousel as the dashboard sees it, without the slide payload. */
export type CarouselSummary = {
  id: string;
  title: string;
  author: string;
  template: string;
  slideCount: number;
  coverTitle: string;
  /** The first slide, verbatim, so the gallery can render a true miniature of it. */
  cover: string;
  /** Bumped on every write. A client must send back the one it last read. */
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Thrown when the row a write targets no longer exists. */
export class MissingError extends Error {
  constructor() {
    super("That carousel is gone.");
    this.name = "MissingError";
  }
}

/** Thrown when a write is based on a version that is no longer current. */
export class ConflictError extends Error {
  constructor() {
    super("This carousel was changed somewhere else. Reload the page to get the newer version.");
    this.name = "ConflictError";
  }
}

export type CarouselRecord = CarouselSummary & { config: string };

type Row = {
  id: string;
  title: string;
  author: string;
  template: string;
  slide_count: number;
  cover_title: string;
  cover: string;
  version: number;
  config: string;
  created_at: string;
  updated_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS carousels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  template TEXT NOT NULL,
  slide_count INTEGER NOT NULL,
  cover_title TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS carousels_updated_at ON carousels (updated_at DESC);
`;

/** Columns added after the first release. SQLite has no "add column if not exists". */
const ADDED_COLUMNS = [
  "ALTER TABLE carousels ADD COLUMN cover TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE carousels ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
];

let ready: Promise<unknown> | null = null;

/**
 * Idempotent, and memoised so it costs one statement per worker instance. The ALTERs
 * bring older tables up to date; a duplicate-column error is the success case.
 */
export function ensureSchema(db: D1Database) {
  ready ??= (async () => {
    await db.exec(SCHEMA.replace(/\n\s*/g, " ").trim());
    for (const statement of ADDED_COLUMNS) {
      try {
        await db.exec(statement);
      } catch {
        // Column already present.
      }
    }
  })().catch((error) => {
    // Memoising the promise means a rejection would otherwise be cached for the
    // isolate's lifetime, so one transient failure would break every later request
    // until the worker recycled. Clear it so the next request retries.
    ready = null;
    throw error;
  });
  return ready;
}

function toSummary(row: Row): CarouselSummary {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    template: row.template,
    slideCount: row.slide_count,
    coverTitle: row.cover_title,
    cover: row.cover,
    version: row.version ?? 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Old rows predate the shared type scale and have no reliable gallery scale. Rebuild
 * the compact cover payload while the list is on the server, so the first browser
 * paint is already the same size as the editor rather than flashing a cover-only fit.
 */
function toListSummary(row: Row): CarouselSummary {
  const summary = toSummary(row);
  if (!row.config) return summary;

  let stored: { slide?: unknown; mark?: unknown; scaleVersion?: number; scale?: unknown } = {};
  try {
    stored = JSON.parse(row.cover || "{}") as typeof stored;
  } catch {
    // Rebuild the compact payload below from the full config.
  }
  if (stored.scaleVersion === 2 && stored.scale) return summary;

  try {
    const parsed = JSON.parse(row.config) as { slides?: unknown[]; mark?: unknown };
    if (!Array.isArray(parsed.slides) || !parsed.slides.length) return summary;
    const slide = stored.slide ?? parsed.slides[0];
    return {
      ...summary,
      cover: JSON.stringify({
        slide,
        scale: deckTypeScale(parsed.slides as CarouselSlide[]),
        scaleVersion: 2,
        mark: typeof stored.mark === "string"
          ? stored.mark
          : typeof parsed.mark === "string"
            ? parsed.mark.slice(0, 30)
            : "",
      }),
    };
  } catch {
    // A malformed legacy cover should still leave the rest of the gallery usable.
    return summary;
  }
}

export async function listCarousels(db: D1Database): Promise<CarouselSummary[]> {
  await ensureSchema(db);
  const { results } = await db
    .prepare("SELECT id, title, author, template, slide_count, cover_title, cover, version, config, created_at, updated_at FROM carousels ORDER BY updated_at DESC LIMIT 200")
    .all<Row>();
  return results.map(toListSummary);
}

export async function getCarousel(db: D1Database, id: string): Promise<CarouselRecord | null> {
  await ensureSchema(db);
  const row = await db.prepare("SELECT * FROM carousels WHERE id = ?").bind(id).first<Row>();
  return row ? { ...toSummary(row), config: row.config } : null;
}

export type CarouselInput = {
  id: string;
  title: string;
  author: string;
  template: string;
  slideCount: number;
  coverTitle: string;
  cover: string;
  config: string;
};

/**
 * Writes a carousel, guarded on the version the client last read.
 *
 * This used to be a blind upsert, which is last-write-wins: two editors open on the
 * same deck, or one editor holding state from before an out-of-band change, and the
 * older config silently replaced the newer one. Now the UPDATE only matches a row
 * still at the expected version, so a stale write is refused rather than applied.
 *
 * `expectedVersion` of null means "this is new". created_at survives every update.
 */
export async function saveCarousel(
  db: D1Database,
  input: CarouselInput,
  expectedVersion: number | null,
): Promise<CarouselRecord> {
  await ensureSchema(db);
  const now = new Date().toISOString();

  if (expectedVersion === null) {
    const inserted = await db
      .prepare(
        `INSERT INTO carousels (id, title, author, template, slide_count, cover_title, cover, version, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(input.id, input.title, input.author, input.template, input.slideCount, input.coverTitle, input.cover, input.config, now, now)
      .run();
    // The id already exists, so this is not the new carousel the caller thinks it is.
    if (changes(inserted) === 0) throw new ConflictError();
  } else {
    const updated = await db
      .prepare(
        `UPDATE carousels SET
           title = ?, author = ?, template = ?, slide_count = ?, cover_title = ?,
           cover = ?, config = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND version = ?`,
      )
      .bind(input.title, input.author, input.template, input.slideCount, input.coverTitle, input.cover, input.config, now, input.id, expectedVersion)
      .run();

    if (changes(updated) === 0) {
      // No row matched: either it is gone, or someone else has written since.
      const current = await getCarousel(db, input.id);
      if (!current) throw new MissingError();
      throw new ConflictError();
    }
  }

  const saved = await getCarousel(db, input.id);
  if (!saved) throw new Error("The carousel did not save.");
  return saved;
}

/** D1 reports affected rows on meta.changes. Absent means we cannot tell, so assume it worked. */
function changes(result: D1RunResult) {
  return result?.meta?.changes ?? 1;
}

export async function deleteCarousel(db: D1Database, id: string) {
  await ensureSchema(db);
  await db.prepare("DELETE FROM carousels WHERE id = ?").bind(id).run();
}
