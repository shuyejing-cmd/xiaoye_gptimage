import test from "node:test";
import assert from "node:assert/strict";
import { quoteGeneration, pointsForFen } from "../../src/platform/billing/points-pricing.mjs";

test("Ext charges 2, 2, or 3 points by resolution, independent of reference count", () => {
  for (const [resolution, points] of Object.entries({ "1k": 2, "2k": 2, "4k": 3 })) {
    for (const count of [0, 1, 4]) {
      const quote = quoteGeneration({ prompt: "cat", resolution }, count);
      assert.equal(quote.pointsCost, points);
      assert.equal(quote.referenceCount, count);
      assert.equal(quote.priceVersion, 2);
    }
  }
});

test("omitted and auto options both quote 2K for two points", () => {
  assert.deepEqual(quoteGeneration({ prompt: "cat" }, 0).request, { prompt: "cat", size: "1:1", resolution: "2k", quality: "medium", output_format: "png", n: 1 });
  const explicitAuto = quoteGeneration({ prompt: "cat", size: "auto", resolution: "auto", quality: "auto" }, 4);
  assert.equal(explicitAuto.pointsCost, 2);
  assert.deepEqual([explicitAuto.request.size, explicitAuto.request.resolution, explicitAuto.request.quality], ["1:1", "2k", "medium"]);
});

test("unsupported Ext quality, ratio, and output format fail before a wallet hold", () => {
  assert.throws(() => quoteGeneration({ prompt: "cat", quality: "high" }), (error) => error.code === "unsupported_ext_quality");
  assert.throws(() => quoteGeneration({ prompt: "cat", quality: "low" }), (error) => error.code === "unsupported_ext_quality");
  assert.throws(() => quoteGeneration({ prompt: "cat", size: "2:1" }), (error) => error.code === "unsupported_ext_size");
  assert.throws(() => quoteGeneration({ prompt: "cat", output_format: "webp" }), (error) => error.code === "unsupported_ext_output_format");
});

test("manual GPT.Ge fallback retains its prior price and supported options", () => {
  const quote = quoteGeneration({ prompt: "edit", size: "2:1", resolution: "2k", quality: "high", output_format: "jpeg" }, 2, "gpt_ge");
  assert.equal(quote.pointsCost, 25);
  assert.equal(quote.priceVersion, 1);
  assert.equal(quote.request.size, "2:1");
});

test("package prices convert from ten-fen units without fractional points", () => {
  assert.equal(pointsForFen(10), 1);
  assert.equal(pointsForFen(100), 10);
  assert.throws(() => pointsForFen(15), (error) => error.code === "invalid_recharge_package");
});
