import test from "node:test";
import assert from "node:assert/strict";
import { parseGenerationRequest } from "../../src/shared/contracts.mjs";

test("rejects unsupported first-version options", () => {
  assert.throws(() => parseGenerationRequest({ prompt: "fox", resolution: "4k" }), /resolution/);
  assert.throws(() => parseGenerationRequest({ prompt: "fox", n: 2 }), /n/);
  assert.throws(() => parseGenerationRequest({ prompt: "fox", background: "transparent" }), /background/);
});

test("normalizes first-version defaults", () => {
  assert.deepEqual(parseGenerationRequest({ prompt: "fox" }), {
    prompt: "fox", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1
  });
});