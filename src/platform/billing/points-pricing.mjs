import { AppError } from "../../shared/errors.mjs";
import { parseGenerationRequest } from "../../shared/contracts.mjs";

export const PRICE_VERSION = 1;
export const PRICE_TABLE = Object.freeze({
  "1k": Object.freeze({ low: 2, medium: 3, high: 8 }),
  "2k": Object.freeze({ low: 3, medium: 5, high: 15 }),
  "4k": Object.freeze({ low: 4, medium: 7, high: 22 })
});
export const REFERENCE_IMAGE_POINTS = 5;

export function pointsForFen(priceFen) {
  if (!Number.isSafeInteger(priceFen) || priceFen <= 0 || priceFen % 10 !== 0) {
    throw new AppError({ code: "invalid_recharge_package", message: "套餐金额必须是 0.10 元的整数倍", httpStatus: 400 });
  }
  return priceFen / 10;
}

export function quoteGeneration(input, referenceCount = 0) {
  if (!Number.isInteger(referenceCount) || referenceCount < 0 || referenceCount > 4) {
    throw new AppError({ code: "too_many_reference_images", message: "参考图最多 4 张", httpStatus: 400 });
  }
  const parsed = parseGenerationRequest(input);
  const request = {
    ...parsed,
    size: parsed.size === "auto" ? "1:1" : parsed.size,
    resolution: parsed.resolution === "auto" ? "2k" : parsed.resolution,
    quality: parsed.quality === "auto" ? "medium" : parsed.quality
  };
  return {
    request,
    priceVersion: PRICE_VERSION,
    pointsCost: PRICE_TABLE[request.resolution][request.quality] + referenceCount * REFERENCE_IMAGE_POINTS,
    referenceCount
  };
}
