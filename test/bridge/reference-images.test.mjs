import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReferenceImagePaths } from "../../src/bridge/reference-images.mjs";

test("maps the legacy single reference-image path into an ordered array", () => {
  assert.deepEqual(normalizeReferenceImagePaths({ referenceImagePath: "C:/Pictures/one.png" }), ["C:/Pictures/one.png"]);
});

test("accepts up to four ordered reference-image paths", () => {
  assert.deepEqual(normalizeReferenceImagePaths({ referenceImagePaths: ["one.png", "two.png", "three.png", "four.png"] }), ["one.png", "two.png", "three.png", "four.png"]);
});

test("rejects both legacy and multi-image parameters together", () => {
  assert.throws(() => normalizeReferenceImagePaths({ referenceImagePath: "one.png", referenceImagePaths: ["two.png"] }), (error) => error.code === "reference_images_ambiguous");
});

test("rejects more than four reference images", () => {
  assert.throws(() => normalizeReferenceImagePaths({ referenceImagePaths: ["1.png", "2.png", "3.png", "4.png", "5.png"] }), (error) => error.code === "too_many_reference_images");
});
test("rejects an empty reference image path array", () => {
  assert.throws(
    () => normalizeReferenceImagePaths({ referenceImagePaths: [] }),
    (error) => error.code === "invalid_reference_images"
  );
});