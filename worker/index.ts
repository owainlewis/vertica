/** Worker entry point: the JSON API under /api, the rendered app for everything else. */
import handler from "vinext/server/app-router-entry";
import { handleApi, type ApiEnv } from "./api.ts";
import type { D1Database } from "./db.ts";
import type { R2Bucket } from "./media.ts";

interface Env extends ApiEnv {
  DB?: D1Database;
  APP_SECRET?: string;
  MEDIA?: R2Bucket;
  /** Static assets, served by the framework handler. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
