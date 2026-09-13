import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectImage } from "../src/inspect-image.mjs";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8VwAAAABJRU5ErkJggg==",
  "base64",
);

test("inspectImage reports a readable PNG file without exposing its contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "image-probe-"));
  const imagePath = join(directory, "reference.png");
  await writeFile(imagePath, ONE_PIXEL_PNG);

  const result = await inspectImage(imagePath);

  assert.equal(result.exists, true);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.bytes, ONE_PIXEL_PNG.length);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal("content" in result, false);
});

test("inspectImage rejects a non-image file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "image-probe-"));
  const textPath = join(directory, "not-an-image.txt");
  await writeFile(textPath, "not an image");

  await assert.rejects(() => inspectImage(textPath), /Unsupported image format/);
});
