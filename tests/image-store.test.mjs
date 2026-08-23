import assert from "node:assert/strict";
import test from "node:test";
import { putImage } from "../app/image-store.ts";

test("deduplicates concurrent durable uploads for the same image", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const originalFetch = globalThis.fetch;
  let uploads = 0;
  let releaseUpload;
  const uploadGate = new Promise((resolve) => { releaseUpload = resolve; });

  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.error = new Error("IndexedDB is blocked");
        request.onerror();
      });
      return request;
    },
  };
  globalThis.fetch = async () => {
    uploads += 1;
    await uploadGate;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const requests = Array.from({ length: 20 }, () => putImage("data:image/png;base64,dW5pcXVlLWNvbmN1cnJlbnQ="));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(uploads, 1);
    releaseUpload();
    const keys = await Promise.all(requests);
    assert.equal(new Set(keys).size, 1);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
    globalThis.fetch = originalFetch;
  }
});
