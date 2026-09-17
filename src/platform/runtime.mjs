import COS from "cos-nodejs-sdk-v5";
import { randomUUID } from "node:crypto";
import { createPool } from "./db/pool.mjs";
import { runMigrations } from "./db/migrations.mjs";
import { createAuthService } from "./auth/auth-service.mjs";
import { createApiKeyService } from "./auth/api-key-service.mjs";
import { createWalletService } from "./billing/wallet-service.mjs";
import { createPayloadCipher } from "./security/payload-cipher.mjs";
import { createGenerationJobs } from "./generation/generation-jobs.mjs";
import { createPaymentService } from "./payments/payment-service.mjs";
import { createCosProofStore } from "./payments/cos-proof-store.mjs";
import { createRateLimiter } from "./http/rate-limiter.mjs";
import { createSmtpMailer } from "./mail/smtp-mailer.mjs";
import { createReferenceStore } from "../gateway/cos-reference-store.mjs";
import { createGptGeClient } from "../gateway/gpt-ge-client.mjs";
import { createApimartClient } from "../gateway/apimart-client.mjs";
import { createInstallationTokenService } from "./installations/installation-token-service.mjs";
import { createReleaseService } from "./installations/release-service.mjs";

export async function createPlatformRuntime(config) {
  const pool = createPool({ connectionString: config.databaseUrl });
  await runMigrations(pool);
  const mailer = createSmtpMailer(config.smtp);
  const cos = new COS({ SecretId: config.cos.secretId, SecretKey: config.cos.secretKey });
  const temporaryStore = createReferenceStore({ ...config.cos, cos });
  const proofStore = createCosProofStore({ bucket: config.cos.bucket, region: config.cos.region, cos });
  const authService = createAuthService({ pool, pepper: config.authPepper, mailer });
  const apiKeyService = createApiKeyService({ pool, pepper: config.apiKeyPepper, cipher: createPayloadCipher({ key: config.apiKeyEncryptionKey }) });
  const installationTokenService = createInstallationTokenService({ pool, pepper: config.installationTokenPepper, apiKeyService });
  const releaseService = createReleaseService({ repository: config.releaseRepository, version: config.installerVersion });
  const walletService = createWalletService({ pool });
  const generationJobs = createGenerationJobs({ pool, cipher: createPayloadCipher({ key: config.payloadEncryptionKey }), requestIdFactory: randomUUID });
  const paymentService = createPaymentService({ pool, proofStore, orderNoFactory: () => `WB${Date.now()}${randomUUID().slice(0, 8).toUpperCase()}` });
  const provider = config.imageProvider === "gpt_ge" ? createGptGeClient(config.gptGe) : createApimartClient(config.apimart);
  if (config.imageProvider === "apimart") provider.mode = "asynchronous";
  return { pool, mailer, temporaryStore, proofStore, authService, apiKeyService, installationTokenService, releaseService, walletService, generationJobs, paymentService, rateLimiter: createRateLimiter({ pool }), provider };
}

export async function ensureBootstrapAdmin({ pool, apiKeyService, email, legacyGatewayToken }) {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  let user = (await pool.query("select * from users where email=$1", [normalized])).rows[0];
  if (!user) {
    user = (await pool.query("insert into users(email,status,role) values($1,'active','admin') returning *", [normalized])).rows[0];
    await pool.query("insert into wallets(user_id,available_credits,held_credits) values($1,0,0) on conflict(user_id) do nothing", [user.id]);
  } else if (user.role !== "admin") {
    user = (await pool.query("update users set role='admin',status='active',updated_at=now() where id=$1 returning *", [user.id])).rows[0];
  }
  if (legacyGatewayToken) await apiKeyService.importLegacy({ userId: user.id, rawKey: legacyGatewayToken });
  return user;
}
