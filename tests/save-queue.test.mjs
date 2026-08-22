import assert from "node:assert/strict";
import test from "node:test";
import { SaveQueue } from "../app/save-queue.ts";

test("coalesces edits made before a save starts", async () => {
  const saved = [];
  const queue = new SaveQueue(async (value) => {
    saved.push(value);
    return value;
  });

  queue.enqueue("first draft");
  queue.enqueue("latest draft");
  await queue.flush();

  assert.deepEqual(saved, ["latest draft"]);
  assert.equal(queue.dirty, false);
});

test("serializes a newer edit behind the save already in flight", async () => {
  const saved = [];
  let active = 0;
  let mostActive = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const queue = new SaveQueue(async (value) => {
    active += 1;
    mostActive = Math.max(mostActive, active);
    saved.push(value);
    if (value === "first") await firstGate;
    active -= 1;
    return value;
  });

  queue.enqueue("first");
  const firstFlush = queue.flush();
  await Promise.resolve();
  queue.enqueue("second");
  const secondFlush = queue.flush();
  releaseFirst();
  await Promise.all([firstFlush, secondFlush]);

  assert.deepEqual(saved, ["first", "second"]);
  assert.equal(mostActive, 1, "only one write may be active at a time");
  assert.equal(queue.dirty, false);
});

test("keeps a failed save dirty so an explicit retry can persist it", async () => {
  let attempts = 0;
  const queue = new SaveQueue(async (value) => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
    return value;
  });

  queue.enqueue("keep me");
  await assert.rejects(queue.flush(), /offline/);
  assert.equal(queue.dirty, true);

  assert.equal(await queue.flush(), "keep me");
  assert.equal(attempts, 2);
  assert.equal(queue.dirty, false);
});
