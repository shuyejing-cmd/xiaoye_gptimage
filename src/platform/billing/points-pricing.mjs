import { AppError } from "../../shared/errors.mjs";
import { parseGenerationRequest } from "../../shared/contracts.mjs";

export const PRICE_VERSION = 2;
export const PRICE_TABLE = Object.freeze({
  "1k": 2,
  "2k": 2,
  "4k": 3
});
export const REFERENCE_IMAGE_POINTS = 0;
export const LEGACY_PRICE_TABLE = Object.freeze({
  "1k": Object.freeze({ low: 2, medium: 3, high: 8 }),
  "2k": Object.freeze({ low: 3, medium: 5, high: 15 }),
  "4k": Object.freeze({ low: 4, medium: 7, high: 22 })
});
export const LEGACY_REFERENCE_IMAGE_POINTS = 5;
const EXT_SIZES = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"]);

export function pricingForProvider(provider) {
  if (provider === "apimart") return { priceVersion: PRICE_VERSION, priceTable: PRICE_TABLE, referenceImagePoints: REFERENCE_IMAGE_POINTS };
  if (provider === "gpt_ge") return { priceVersion: 1, priceTable: LEGACY_PRICE_TABLE, referenceImagePoints: LEGACY_REFERENCE_IMAGE_POINTS };
  throw new AppError({ code: "invalid_config", message: "未知图片供应商", httpStatus: 500 });
}

export function pointsForFen(priceFen) {
  if (!Number.isSafeInteger(priceFen) || priceFen <= 0 || priceFen % 10 !== 0) {
    throw new AppError({ code: "invalid_recharge_package", message: "套餐金额必须是 0.10 元的整数倍", httpStatus: 400 });
  }
  return priceFen / 10;
}

export function quoteGeneration(input, referenceCount = 0, provider = "apimart") {
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
  const pricing = pricingForProvider(provider);
  if (provider === "apimart") {
    if (!EXT_SIZES.has(request.size)) throw new AppError({ code: "unsupported_ext_size", message: "当前生图服务不支持这个画面比例", httpStatus: 400 });
    if (request.quality !== "medium") throw new AppError({ code: "unsupported_ext_quality", message: "当前生图服务不支持 low/high 质量档，请省略质量参数", httpStatus: 400 });
    if (request.output_format !== "png") throw new AppError({ code: "unsupported_ext_output_format", message: "当前生图服务不支持指定输出格式，请省略格式参数", httpStatus: 400 });
  }
  return {
    request,
    priceVersion: pricing.priceVersion,
    pointsCost: provider === "apimart" ? pricing.priceTable[request.resolution] : pricing.priceTable[request.resolution][request.quality] + referenceCount * pricing.referenceImagePoints,
    referenceCount
  };
}
