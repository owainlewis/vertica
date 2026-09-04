/**
 * The one storage abstraction. Everything the app keeps, decks and media alike, is
 * an object in a bucket with a content type, a generation and a bag of string
 * metadata. Google Cloud Storage in production, a folder on disk in development
 * and tests. No database.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export type ObjectMeta = {
  /** Changes on every write. A conditional put names the generation it expects. */
  generation: number;
  contentType: string;
  custom: Record<string, string>;
  updated: string;
};

export type StoredObject = { bytes: Uint8Array; meta: ObjectMeta };

export type PutOptions = {
  contentType: string;
  custom?: Record<string, string>;
  /** The generation the object must currently have. 0 means it must not exist. */
  ifGeneration?: number;
};

/** Thrown when a conditional put finds a different generation than it expected. */
export class PreconditionError extends Error {
  constructor() {
    super("The object changed underneath this write.");
    this.name = "PreconditionError";
  }
}

export interface Bucket {
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<ObjectMeta | null>;
  put(key: string, bytes: Uint8Array, options: PutOptions): Promise<ObjectMeta>;
  delete(key: string): Promise<void>;
  /** Every object under a prefix, metadata only, in no particular order. */
  list(prefix: string): Promise<Array<{ key: string; meta: ObjectMeta }>>;
}

/**
 * A folder on disk. Each object is a file plus a sidecar `.meta.json`. Good enough
 * for one developer and for tests; not safe for two writers at once, which is why
 * production uses the real thing.
 */
export class LocalBucket implements Bucket {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private path(key: string) {
    return join(this.root, key);
  }

  private async readMeta(key: string): Promise<ObjectMeta | null> {
    try {
      return JSON.parse(await readFile(`${this.path(key)}.meta.json`, "utf8")) as ObjectMeta;
    } catch {
      return null;
    }
  }

  async get(key: string) {
    const meta = await this.readMeta(key);
    if (!meta) return null;
    return { bytes: new Uint8Array(await readFile(this.path(key))), meta };
  }

  head(key: string) {
    return this.readMeta(key);
  }

  async put(key: string, bytes: Uint8Array, options: PutOptions) {
    const current = await this.readMeta(key);
    if (options.ifGeneration !== undefined && (current?.generation ?? 0) !== options.ifGeneration) {
      throw new PreconditionError();
    }
    const meta: ObjectMeta = {
      generation: Math.max(Date.now(), (current?.generation ?? 0) + 1),
      contentType: options.contentType,
      custom: options.custom ?? current?.custom ?? {},
      updated: new Date().toISOString(),
    };
    await mkdir(dirname(this.path(key)), { recursive: true });
    await writeFile(this.path(key), bytes);
    await writeFile(`${this.path(key)}.meta.json`, JSON.stringify(meta));
    return meta;
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
    await rm(`${this.path(key)}.meta.json`, { force: true });
  }

  async list(prefix: string) {
    const directory = this.path(prefix);
    let entries: string[];
    try {
      if (!(await stat(directory)).isDirectory()) return [];
      entries = await readdir(directory, { recursive: true });
    } catch {
      return [];
    }
    const found: Array<{ key: string; meta: ObjectMeta }> = [];
    for (const entry of entries) {
      if (!entry.endsWith(".meta.json")) continue;
      const key = join(prefix, entry.slice(0, -".meta.json".length));
      const meta = await this.readMeta(key);
      if (meta) found.push({ key: relative(".", key), meta });
    }
    return found;
  }
}

/** Google Cloud Storage. Generation-match preconditions give the version check for free. */
export class GcsBucket implements Bucket {
  private readonly ready: Promise<import("@google-cloud/storage").Bucket>;

  constructor(name: string) {
    this.ready = import("@google-cloud/storage").then(({ Storage }) => new Storage().bucket(name));
  }

  private toMeta(raw: { generation?: unknown; contentType?: unknown; metadata?: unknown; updated?: unknown }): ObjectMeta {
    const custom = raw.metadata && typeof raw.metadata === "object"
      ? Object.fromEntries(Object.entries(raw.metadata as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : {};
    return {
      generation: Number(raw.generation ?? 0),
      contentType: typeof raw.contentType === "string" ? raw.contentType : "application/octet-stream",
      custom,
      updated: typeof raw.updated === "string" ? raw.updated : new Date().toISOString(),
    };
  }

  async get(key: string) {
    const file = (await this.ready).file(key);
    try {
      const [[bytes], [raw]] = await Promise.all([file.download(), file.getMetadata()]);
      return { bytes: new Uint8Array(bytes), meta: this.toMeta(raw) };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async head(key: string) {
    try {
      const [raw] = await (await this.ready).file(key).getMetadata();
      return this.toMeta(raw);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async put(key: string, bytes: Uint8Array, options: PutOptions) {
    const file = (await this.ready).file(key);
    try {
      await file.save(Buffer.from(bytes), {
        resumable: false,
        contentType: options.contentType,
        metadata: { metadata: options.custom ?? {} },
        ...(options.ifGeneration !== undefined ? { preconditionOpts: { ifGenerationMatch: options.ifGeneration } } : {}),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 412) throw new PreconditionError();
      throw error;
    }
    const [raw] = await file.getMetadata();
    return this.toMeta(raw);
  }

  async delete(key: string) {
    await (await this.ready).file(key).delete({ ignoreNotFound: true });
  }

  async list(prefix: string) {
    const [files] = await (await this.ready).getFiles({ prefix });
    return files.map((file) => ({ key: file.name, meta: this.toMeta(file.metadata) }));
  }
}

function isNotFound(error: unknown) {
  return (error as { code?: number }).code === 404;
}

/** Production reads the bucket name from the environment; everything else uses disk. */
export function bucketFromEnv(env: NodeJS.ProcessEnv = process.env): Bucket {
  return env.BUCKET ? new GcsBucket(env.BUCKET) : new LocalBucket(env.DATA_DIR ?? ".data");
}
