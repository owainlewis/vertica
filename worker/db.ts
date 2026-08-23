/** Carousel storage on D1. One table, so plain SQL rather than an ORM. */

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

/** A reusable media item. `kind` is explicit so video can join the library later. */
export type MediaAsset = {
  key: string;
  kind: "image" | "video";
  name: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  createdAt: string;
  updatedAt: string;
};

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

type MediaRow = {
  key: string;
  kind: "image" | "video";
  name: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  byte_size: number | null;
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
CREATE TABLE IF NOT EXISTS media_assets (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'image',
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_assets_updated_at ON media_assets (updated_at DESC);
CREATE TABLE IF NOT EXISTS media_gc (
  key TEXT PRIMARY KEY,
  not_before TEXT NOT NULL,
  claim TEXT,
  claim_until TEXT
);
CREATE INDEX IF NOT EXISTS media_gc_not_before ON media_gc (not_before);
`;

/** Columns added after the first release. SQLite has no "add column if not exists". */
const ADDED_COLUMNS = [
  "ALTER TABLE carousels ADD COLUMN cover TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE carousels ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE media_gc ADD COLUMN claim TEXT",
  "ALTER TABLE media_gc ADD COLUMN claim_until TEXT",
];

/** Populate the compact gallery payload for rows saved before `cover` existed. */
const BACKFILL_COVERS = `
UPDATE carousels
SET cover = json_object(
  'slide', json_extract(config, '$.slides[0]'),
  'mark', CASE
    WHEN json_type(config, '$.mark') = 'text' THEN substr(json_extract(config, '$.mark'), 1, 30)
    ELSE ''
  END
)
WHERE cover = ''
  AND json_valid(config)
  AND json_type(config, '$.slides[0]') = 'object'
`;

/** Turn backgrounds from saved decks into reusable library items after migration. */
const BACKFILL_MEDIA_ASSETS = `
INSERT OR IGNORE INTO media_assets (
  key, kind, name, mime_type, width, height, byte_size, created_at, updated_at
)
SELECT
  json_extract(slide.value, '$.background') AS background,
  'image',
  'Imported image',
  '',
  NULL,
  NULL,
  NULL,
  MAX(carousels.updated_at),
  MAX(carousels.updated_at)
FROM carousels,
  json_each(
    CASE WHEN json_valid(carousels.config) THEN carousels.config ELSE '{"slides":[]}' END,
    '$.slides'
  ) AS slide
WHERE json_type(slide.value, '$.background') = 'text'
  AND length(json_extract(slide.value, '$.background')) = 36
  AND substr(json_extract(slide.value, '$.background'), 1, 4) = 'img:'
  AND substr(json_extract(slide.value, '$.background'), 5) NOT GLOB '*[^0-9a-f]*'
GROUP BY background
`;

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
    // This becomes a no-op after the first successful backfill. Building the JSON in
    // D1 avoids transferring every legacy config through the worker or to the client.
    await db.prepare(BACKFILL_COVERS).run();
    await db.prepare(BACKFILL_MEDIA_ASSETS).run();
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

export async function listCarousels(db: D1Database): Promise<CarouselSummary[]> {
  await ensureSchema(db);
  const { results } = await db
    .prepare("SELECT id, title, author, template, slide_count, cover_title, cover, version, created_at, updated_at FROM carousels ORDER BY updated_at DESC LIMIT 200")
    .all<Row>();
  return results.map(toSummary);
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

function toMediaAsset(row: MediaRow): MediaAsset {
  return {
    key: row.key,
    kind: row.kind,
    name: row.name,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MEDIA_PAGE_SIZE = 60;

function mediaCursor(asset: MediaAsset) {
  return btoa(JSON.stringify([asset.updatedAt, asset.key]));
}

function readMediaCursor(cursor: string | null) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(atob(cursor));
    if (!Array.isArray(value) || value.length !== 2 || value.some((part) => typeof part !== "string")) return null;
    return { updatedAt: value[0] as string, key: value[1] as string };
  } catch {
    return null;
  }
}

export async function listMediaAssets(db: D1Database, cursor: string | null = null) {
  await ensureSchema(db);
  const position = readMediaCursor(cursor);
  const select = `SELECT key, kind, name, mime_type, width, height, byte_size, created_at, updated_at
    FROM media_assets`;
  const statement = position
    ? db.prepare(
      `${select}
       WHERE updated_at < ? OR (updated_at = ? AND key < ?)
       ORDER BY updated_at DESC, key DESC LIMIT ?`,
    ).bind(position.updatedAt, position.updatedAt, position.key, MEDIA_PAGE_SIZE + 1)
    : db.prepare(`${select} ORDER BY updated_at DESC, key DESC LIMIT ?`).bind(MEDIA_PAGE_SIZE + 1);
  const { results } = await statement.all<MediaRow>();
  const items = results.slice(0, MEDIA_PAGE_SIZE).map(toMediaAsset);
  return {
    items,
    nextCursor: results.length > MEDIA_PAGE_SIZE && items.length ? mediaCursor(items.at(-1)!) : null,
  };
}

export async function upsertMediaAsset(
  db: D1Database,
  input: Omit<MediaAsset, "createdAt" | "updatedAt">,
) {
  await ensureSchema(db);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO media_assets (
       key, kind, name, mime_type, width, height, byte_size, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       name = excluded.name,
       mime_type = excluded.mime_type,
       width = COALESCE(excluded.width, media_assets.width),
       height = COALESCE(excluded.height, media_assets.height),
       byte_size = COALESCE(excluded.byte_size, media_assets.byte_size),
       updated_at = excluded.updated_at`,
  ).bind(
    input.key,
    input.kind,
    input.name,
    input.mimeType,
    input.width,
    input.height,
    input.byteSize,
    now,
    now,
  ).run();
}

export async function removeMediaAsset(db: D1Database, key: string) {
  await ensureSchema(db);
  const result = await db.prepare(
    `DELETE FROM media_assets
     WHERE key = ?
       AND NOT EXISTS (SELECT 1 FROM carousels WHERE instr(config, ?) > 0)`,
  ).bind(key, key).run();
  if (changes(result) > 0) return "deleted" as const;
  const existing = await db.prepare("SELECT key FROM media_assets WHERE key = ?").bind(key).first<{ key: string }>();
  return existing ? "in-use" as const : "missing" as const;
}

/** A library item is durable even when no carousel currently uses it. */
export async function unqueueMediaCleanup(db: D1Database, key: string) {
  await ensureSchema(db);
  await db.prepare("DELETE FROM media_gc WHERE key = ? AND claim IS NULL").bind(key).run();
}

/**
 * Queue possible orphans instead of deleting immediately. The delay prevents a
 * concurrent save that has just uploaded the same content hash from losing it.
 */
export async function queueMediaCleanup(db: D1Database, keys: string[]) {
  if (!keys.length) return;
  await ensureSchema(db);
  const notBefore = new Date(Date.now() + 10 * 60_000).toISOString();
  const now = new Date().toISOString();
  await db.batch(keys.map((key) => db.prepare(
    `INSERT INTO media_gc (key, not_before, claim, claim_until) VALUES (?, ?, NULL, NULL)
     ON CONFLICT(key) DO UPDATE SET not_before = excluded.not_before, claim = NULL, claim_until = NULL
     WHERE media_gc.claim IS NULL OR media_gc.claim_until <= ?`,
  ).bind(key, notBefore, now)));
}

/** Waits for an active deletion lease, then gives the key a fresh grace period. */
export async function protectMedia(db: D1Database, keys: string[]) {
  const waited: string[] = [];
  if (!keys.length) return waited;
  await ensureSchema(db);
  for (const key of keys) {
    const deadline = Date.now() + 2_000;
    let didWait = false;
    while (true) {
      const notBefore = new Date(Date.now() + 10 * 60_000).toISOString();
      const now = new Date().toISOString();
      const result = await db.prepare(
        `INSERT INTO media_gc (key, not_before, claim, claim_until) VALUES (?, ?, NULL, NULL)
         ON CONFLICT(key) DO UPDATE SET not_before = excluded.not_before, claim = NULL, claim_until = NULL
         WHERE media_gc.claim IS NULL OR media_gc.claim_until <= ?`,
      ).bind(key, notBefore, now).run();
      if (changes(result) > 0) break;
      didWait = true;
      if (Date.now() >= deadline) throw new Error("That image is busy. Try saving again.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (didWait) waited.push(key);
  }
  return waited;
}

export async function listMediaCleanup(db: D1Database) {
  await ensureSchema(db);
  const { results } = await db
    .prepare("SELECT key, not_before AS notBefore FROM media_gc WHERE not_before <= ? AND (claim IS NULL OR claim_until <= ?) ORDER BY not_before LIMIT 25")
    .bind(new Date().toISOString(), new Date().toISOString())
    .all<{ key: string; notBefore: string }>();
  return results;
}

export async function claimMediaCleanup(db: D1Database, key: string, notBefore: string, claim: string) {
  await ensureSchema(db);
  const now = new Date().toISOString();
  const claimUntil = new Date(Date.now() + 60_000).toISOString();
  const result = await db.prepare(
    `UPDATE media_gc SET claim = ?, claim_until = ?
     WHERE key = ? AND not_before = ? AND not_before <= ?
       AND (claim IS NULL OR claim_until <= ?)`,
  ).bind(claim, claimUntil, key, notBefore, now, now).run();
  return changes(result) > 0;
}

export async function isMediaReferenced(db: D1Database, key: string) {
  await ensureSchema(db);
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM carousels WHERE instr(config, ?) > 0
       UNION ALL
       SELECT 1 AS found FROM media_assets WHERE key = ?
       LIMIT 1`,
    )
    .bind(key, key)
    .first<{ found: number }>();
  return Boolean(row);
}

export async function finishMediaCleanup(db: D1Database, key: string, notBefore: string, claim: string) {
  await ensureSchema(db);
  await db.prepare("DELETE FROM media_gc WHERE key = ? AND not_before = ? AND claim = ?").bind(key, notBefore, claim).run();
}

export async function releaseMediaCleanup(db: D1Database, key: string, claim: string) {
  await ensureSchema(db);
  await db.prepare("UPDATE media_gc SET claim = NULL, claim_until = NULL WHERE key = ? AND claim = ?").bind(key, claim).run();
}

/** Keep referenced entries as future work so a concurrent removal cannot be lost. */
export async function postponeMediaCleanup(db: D1Database, key: string, claim: string) {
  await ensureSchema(db);
  const notBefore = new Date(Date.now() + 10 * 60_000).toISOString();
  await db.prepare(
    "UPDATE media_gc SET not_before = ?, claim = NULL, claim_until = NULL WHERE key = ? AND claim = ?",
  ).bind(notBefore, key, claim).run();
}
