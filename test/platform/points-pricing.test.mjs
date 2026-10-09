import test from "node:test";
import assert from "node:assert/strict";
import { quoteGeneration, pointsForFen } from "../../src/platform/billing/points-pricing.mjs";

test("all nine tiers and reference images have fixed server-side prices", () => {
  const tiers = { "1k": { low: 2, medium: 3, high: 8 }, "2k": { low: 3, medium: 5, high: 15 }, "4k": { low: 4, medium: 7, high: 22 } };
  for (const [resolution, qualities] of Object.entries(tiers)) {
    for (const [quality, points] of Object.entries(qualities)) {
      assert.equal(quoteGeneration({ prompt: "cat", resolution, quality }, 0).pointsCost, points);
      assert.equal(quoteGeneration({ prompt: "cat", resolution, quality }, 2).pointsCost, points + 10);
    }
  }
});

test("auto and omitted parameters use the 2K medium price", () => {
  assert.deepEqual(quoteGeneration({ prompt: "cat" }, 0).request, { prompt: "cat", size: "1:1", resolution: "2k", quality: "medium", output_format: "png", n: 1 });
  const explicitAuto = quoteGeneration({ prompt: "cat", size: "auto", resolution: "auto", quality: "auto" }, 4);
  assert.equal(explicitAuto.pointsCost, 25);
  assert.deepEqual([explicitAuto.request.size, explicitAuto.request.resolution, explicitAuto.request.quality], ["1:1", "2k", "medium"]);
});

test("package prices convert from ten-fen units without fractional points", () => {
  assert.equal(pointsForFen(10), 1);
  assert.equal(pointsForFen(100), 10);
  assert.throws(() => pointsForFen(15), (error) => error.code === "invalid_recharge_package");
});
