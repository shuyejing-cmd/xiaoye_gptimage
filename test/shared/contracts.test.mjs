import test from "node:test";
import assert from "node:assert/strict";
import { parseGenerationRequest } from "../../src/shared/contracts.mjs";

test("accepts every supported APIMart resolution", () => {
  for (const resolution of ["auto", "1k", "2k", "4k"]) {
    assert.equal(parseGenerationRequest({ prompt: "fox", resolution }).resolution, resolution);
  }
});

test("rejects unsupported first-version options", () => {
  assert.throws(() => parseGenerationRequest({ prompt: "fox", n: 2 }), /n/);
  assert.throws(() => parseGenerationRequest({ prompt: "fox", background: "transparent" }), /background/);
});

test("normalizes points-version defaults", () => {
  assert.deepEqual(parseGenerationRequest({ prompt: "fox" }), {
    prompt: "fox", size: "1:1", resolution: "2k", quality: "medium", output_format: "png", n: 1
  });
});
