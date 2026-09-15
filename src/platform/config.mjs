import { AppError } from "../shared/errors.mjs";

function requireValues(env, names) {
  for (const name of names) if (!env[name]) throw new AppError({ code: "missing_config", message: `Missing ${name}`, httpStatus: 500 });
}

function encryptionKey(value, name) {
  const buffer = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (buffer.length !== 32) throw new AppError({ code: "invalid_config", message: `${name} must encode exactly 32 bytes`, httpStatus: 500 });
  return buffer;
}

export function loadPlatformConfig(env = process.env) {
  requireValues(env, ["DATABASE_URL", "AUTH_PEPPER", "API_KEY_PEPPER", "API_KEY_ENCRYPTION_KEY", "PAYLOAD_ENCRYPTION_KEY", "COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION", "SMTP_HOST", "SMTP_FROM"]);
  const imageProvider = env.IMAGE_PROVIDER || "gpt_ge";
  if (!new Set(["gpt_ge", "apimart"]).has(imageProvider)) throw new AppError({ code: "invalid_config", message: "IMAGE_PROVIDER must be gpt_ge or apimart", httpStatus: 500 });
  requireValues(env, [imageProvider === "gpt_ge" ? "GPT_GE_API_KEY" : "APIMART_API_KEY"]);
  return {
    databaseUrl: env.DATABASE_URL,
    authPepper: env.AUTH_PEPPER,
    apiKeyPepper: env.API_KEY_PEPPER,
    apiKeyEncryptionKey: encryptionKey(env.API_KEY_ENCRYPTION_KEY, "API_KEY_ENCRYPTION_KEY"),
    payloadEncryptionKey: encryptionKey(env.PAYLOAD_ENCRYPTION_KEY, "PAYLOAD_ENCRYPTION_KEY"),
    imageProvider,
    providerConcurrency: Math.max(1, Number(env.WORKER_CONCURRENCY || 2)),
    publicRegistrationEnabled: env.PUBLIC_REGISTRATION_ENABLED === "true",
    cookieSecure: env.COOKIE_SECURE !== "false",
    port: Number(env.PORT || 3000),
    cos: { secretId: env.COS_SECRET_ID, secretKey: env.COS_SECRET_KEY, bucket: env.COS_BUCKET, region: env.COS_REGION, prefix: env.COS_PREFIX || "private/workbuddy-images" },
    gptGe: { apiKey: env.GPT_GE_API_KEY, baseUrl: env.GPT_GE_BASE_URL || "https://api.gpt.ge/v1" },
    apimart: { apiKey: env.APIMART_API_KEY, baseUrl: env.APIMART_BASE_URL || "https://api.apimart.ai/v1" },
    smtp: { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465), secure: env.SMTP_SECURE !== "false", user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM },
    adminNotificationEmail: env.ADMIN_NOTIFICATION_EMAIL || env.SMTP_FROM,
    legacyGatewayToken: env.MCP_GATEWAY_TOKEN || null,
    adminEmail: env.BOOTSTRAP_ADMIN_EMAIL || null
  };
}
