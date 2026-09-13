import { AppError } from "../shared/errors.mjs";

const commonRequired = ["MCP_GATEWAY_TOKEN", "COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION"];

export function loadConfig(env = process.env) {
  for (const key of commonRequired) if (!env[key]) throw new AppError({ code: "missing_config", message: `Missing ${key}`, httpStatus: 500 });
  const imageProvider = env.IMAGE_PROVIDER || "apimart";
  if (!new Set(["apimart", "gpt_ge"]).has(imageProvider)) throw new AppError({ code: "invalid_config", message: "IMAGE_PROVIDER must be apimart or gpt_ge", httpStatus: 500 });
  if (imageProvider === "apimart" && !env.APIMART_API_KEY) throw new AppError({ code: "missing_config", message: "Missing APIMART_API_KEY", httpStatus: 500 });
  if (imageProvider === "gpt_ge" && !env.GPT_GE_API_KEY) throw new AppError({ code: "missing_config", message: "Missing GPT_GE_API_KEY", httpStatus: 500 });
  return {
    imageProvider,
    apiKey: env.APIMART_API_KEY,
    apiBaseUrl: env.APIMART_BASE_URL || "https://api.apimart.ai/v1",
    gptGe: { apiKey: env.GPT_GE_API_KEY, baseUrl: env.GPT_GE_BASE_URL || "https://api.gpt.ge/v1" },
    gatewayToken: env.MCP_GATEWAY_TOKEN,
    cos: { secretId: env.COS_SECRET_ID, secretKey: env.COS_SECRET_KEY, bucket: env.COS_BUCKET, region: env.COS_REGION, prefix: env.COS_PREFIX || "workbuddy-reference-images" },
    port: Number(env.PORT || 3000),
    sqlitePath: env.SQLITE_PATH || "data/tasks.sqlite",
    pollIntervalMs: 2000,
    pollTimeoutMs: 90000
  };
}