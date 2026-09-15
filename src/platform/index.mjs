import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import { loadPlatformConfig } from "./config.mjs";
import { createPlatformRuntime, ensureBootstrapAdmin } from "./runtime.mjs";
import { createPlatformApp } from "./http/platform-app.mjs";

const config = loadPlatformConfig();
const runtime = await createPlatformRuntime(config);
await ensureBootstrapAdmin({ pool: runtime.pool, apiKeyService: runtime.apiKeyService, email: config.adminEmail, legacyGatewayToken: config.legacyGatewayToken });
const app = createPlatformApp({ ...runtime, provider: config.imageProvider, readyCheck: async () => {
  await runtime.pool.query("select 1");
  const invalid = await runtime.pool.query("select count(*)::int as count from wallets where available_credits<0 or held_credits<0");
  return Number(invalid.rows[0].count) === 0;
}, generationAdmissionCheck: async () => {
  const invalid = await runtime.pool.query("select count(*)::int as count from wallets where available_credits<0 or held_credits<0");
  const unresolved = await runtime.pool.query("select count(*)::int as count from generation_jobs where state in ('unknown','manual_review')");
  return Number(invalid.rows[0].count) === 0 && Number(unresolved.rows[0].count) < 100;
}, publicRegistrationEnabled: config.publicRegistrationEnabled, cookieSecure: config.cookieSecure, logger: true });

const webRoot = resolve("web/dist");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/") || request.url.startsWith("/v1/") || request.url.startsWith("/downloads/")
    ? reply.code(404).send({ error: { code: "not_found", message: "接口不存在" } })
    : reply.sendFile("index.html"));
}

const stop = async () => { await app.close(); await runtime.pool.end(); process.exit(0); };
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
await app.listen({ host: "0.0.0.0", port: config.port });
