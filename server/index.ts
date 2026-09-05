/**
 * The whole service: the JSON API under /api and the built app for everything
 * else. One Node process, one bucket, one container on Cloud Run.
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { createApi } from "./api.ts";
import { bucketFromEnv } from "./bucket.ts";

export type ServerOptions = {
  bucket: ReturnType<typeof bucketFromEnv>;
  secret?: string;
  dist: string;
};

/** Production must never fall back to ephemeral disk or an unprotected API. */
export function serverOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): ServerOptions {
  if (env.NODE_ENV === "production") {
    const missing = [!env.BUCKET && "BUCKET", !env.APP_SECRET && "APP_SECRET"].filter(Boolean);
    if (missing.length) throw new Error(`${missing.join(" and ")} must be set in production.`);
  }

  return {
    bucket: bucketFromEnv(env),
    secret: env.APP_SECRET,
    dist: env.DIST_DIR ?? "dist",
  };
}

export function createServer(options = serverOptionsFromEnv()) {
  const app = new Hono();
  app.route("/api", createApi(options));
  app.use("/*", serveStatic({ root: options.dist }));
  // Any other path is the app; the client router reads the URL from there.
  app.get("*", async (c) => c.html(await readFile(`${options.dist}/index.html`, "utf8")));
  return app;
}

if (process.argv[1]?.endsWith("server/index.ts")) {
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: createServer().fetch, port }, () => {
    console.log(`Vertica listening on http://localhost:${port}`);
  });
}
