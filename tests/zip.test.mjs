import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createZip, dataUrlToBytes } from "../app/zip.ts";

async function zipBytes(files) {
  return Buffer.from(await createZip(files).arrayBuffer());
}

test("writes an archive that a real unzip tool can read", async () => {
  const files = [
    { name: "deck-01.jpg", bytes: new TextEncoder().encode("first page bytes") },
    { name: "deck-02.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x10, 0xff, 0xd9]) },
    { name: "deck-03.jpg", bytes: new Uint8Array(5000).fill(0x42) },
  ];

  const directory = mkdtempSync(join(tmpdir(), "vertica-zip-"));
  const archive = join(directory, "deck.zip");
  writeFileSync(archive, await zipBytes(files));

  // Python's zipfile validates the CRC of every entry on read, so a bad checksum
  // or a wrong offset in the central directory fails here rather than in Finder.
  const listing = execFileSync("python3", [
    "-c",
    `import zipfile,sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, "corrupt entry"
print("|".join(f"{i.filename}:{i.file_size}" for i in z.infolist()))
print(z.read("deck-01.jpg").decode())`,
    archive,
  ]).toString().trim().split("\n");

  assert.equal(listing[0], "deck-01.jpg:16|deck-02.jpg:7|deck-03.jpg:5000");
  assert.equal(listing[1], "first page bytes");
});

test("an empty archive is still a valid one", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vertica-zip-empty-"));
  const archive = join(directory, "empty.zip");
  writeFileSync(archive, await zipBytes([]));

  const count = execFileSync("python3", [
    "-c",
    "import zipfile,sys; print(len(zipfile.ZipFile(sys.argv[1]).infolist()))",
    archive,
  ]).toString().trim();

  assert.equal(count, "0");
});

test("decodes a base64 data URL back to its exact bytes", () => {
  const bytes = dataUrlToBytes("data:image/jpeg;base64,/9j/4AAQ");
  assert.deepEqual([...bytes], [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
});
