import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createAuthService } from "../../src/platform/auth/auth-service.mjs";
import { createApiKeyService } from "../../src/platform/auth/api-key-service.mjs";
import { createWalletService } from "../../src/platform/billing/wallet-service.mjs";
import { createPayloadCipher } from "../../src/platform/security/payload-cipher.mjs";
import { createGenerationJobs } from "../../src/platform/generation/generation-jobs.mjs";
import { createInstallationTokenService } from "../../src/platform/installations/installation-token-service.mjs";
import { createRateLimiter } from "../../src/platform/http/rate-limiter.mjs";
import { createPlatformApp } from "../../src/platform/http/platform-app.mjs";
import { discoverWorkBuddyConfig } from "../../installer/config-discovery.mjs";
import { exchangeInstallationToken } from "../../installer/installation-client.mjs";
import { installVerifiedWorkBuddyConfig } from "../../installer/config-manager.mjs";

function responseFromInjection(injected) {
  return new Response(injected.body, {
    status: injected.statusCode,
    headers: { "content-type": injected.headers["content-type"] || "application/json" }
  });
}

test("prompt-guided install keeps the long-lived Key out of prompts, arguments, and logs", async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const sent = [];
  let code = 300000;
  const authService = createAuthService({ pool, pepper: "auth", randomCode: () => String(code++), randomToken: () => `session-${code}`, mailer: { sendLoginCode: async (value) => sent.push(value) } });
  const apiKeyService = createApiKeyService({ pool, pepper: "keys", cipher: createPayloadCipher({ key: Buffer.alloc(32, 7) }), randomBytes: () => Buffer.alloc(24, 9) });
  const walletService = createWalletService({ pool });
  const installationTokenService = createInstallationTokenService({ pool, pepper: "installation-tokens", apiKeyService, randomBytes: () => Buffer.alloc(24, 21) });
  const app = createPlatformApp({
    pool,
    authService,
    apiKeyService,
    installationTokenService,
    walletService,
    generationJobs: createGenerationJobs({ pool, cipher: createPayloadCipher({ key: Buffer.alloc(32, 4) }) }),
    rateLimiter: createRateLimiter({ pool }),
    temporaryStore: { putReference: async () => ({ objectKey: "private/reference.png" }) },
    publicRegistrationEnabled: true,
    publicOrigin: "https://xiaoyeai.cn",
    installerVersion: "1.1.0",
    readyCheck: async () => true
  });

  try {
    const email = "prompt-install@example.com";
    const deviceId = "prompt-install-browser";
    await app.inject({ method: "POST", url: "/api/auth/email-code", payload: { email, device_id: deviceId } });
    const verified = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { email, code: sent.at(-1).code, device_id: deviceId } });
    const cookie = verified.headers["set-cookie"].split(";")[0];
    const created = await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie }, payload: { name: "Prompt install" } });
    const longLivedKey = created.json().key;
    assert.match(longLivedKey, /^wb_live_/);

    const issued = await app.inject({ method: "POST", url: `/api/api-keys/${created.json().id}/installation-token`, headers: { cookie } });
    assert.equal(issued.statusCode, 201);
    const prompt = issued.json().prompt;
    const installationToken = prompt.match(/wb_install_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+/)?.[0];
    assert.ok(installationToken);
    assert.doesNotMatch(prompt, /wb_live_/);

    const root = await mkdtemp(join(tmpdir(), "wb-prompt-install-"));
    const userProfile = join(root, "user");
    const configPath = join(userProfile, ".workbuddy", "mcp.json");
    const installDir = join(root, "app");
    const tokenFile = join(root, "token.txt");
    await mkdir(join(userProfile, ".workbuddy"), { recursive: true });
    await mkdir(join(installDir, "runtime"), { recursive: true });
    await mkdir(join(installDir, "app", "src"), { recursive: true });
    const original = { mcpServers: { notes: { command: "notes.exe", env: { KEEP: "yes" } }, search: { command: "search.exe" } }, theme: "dark" };
    await writeFile(configPath, JSON.stringify(original));
    await writeFile(join(installDir, "runtime", "node.exe"), "runtime");
    await writeFile(join(installDir, "app", "src", "index.mjs"), "bridge");
    await writeFile(tokenFile, installationToken, { mode: 0o600 });

    const exchangeFetch = async (_url, options) => responseFromInjection(await app.inject({
      method: "POST",
      url: "/v1/installations/exchange",
      payload: JSON.parse(options.body)
    }));
    const exchanged = await exchangeInstallationToken({ gatewayUrl: "https://xiaoyeai.cn", tokenFile, fetchImpl: exchangeFetch, verifyTokenFile: async () => true });
    await assert.rejects(readFile(tokenFile), (error) => error.code === "ENOENT");
    assert.equal(exchanged.apiKey, longLivedKey);

    const discovered = await discoverWorkBuddyConfig({ userProfile, candidatePaths: [] });
    assert.equal(discovered.configPath, configPath);
    const subprocessArguments = ["/VERYSILENT", `/TOKENFILE=${tokenFile}`];
    const capturedLogs = [JSON.stringify({ status: "installing", configPath }), JSON.stringify({ status: "installed" })];
    const installed = await installVerifiedWorkBuddyConfig({
      configPath: discovered.configPath,
      gatewayUrl: exchanged.gatewayUrl,
      apiKey: exchanged.apiKey,
      allowedRoots: [join(userProfile, "Pictures")],
      installDir,
      mcpProbe: async () => true,
      fetchImpl: async (_url, options) => responseFromInjection(await app.inject({
        method: "GET",
        url: "/v1/account/balance",
        headers: { authorization: options.headers.Authorization }
      }))
    });
    assert.equal(installed.diagnosis.ok, true);
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    const backup = JSON.parse(await readFile(installed.backupPath, "utf8"));
    assert.deepEqual(saved.mcpServers.notes, original.mcpServers.notes);
    assert.deepEqual(saved.mcpServers.search, original.mcpServers.search);
    assert.deepEqual(backup, original);

    const repeated = await app.inject({ method: "POST", url: "/v1/installations/exchange", payload: { installation_token: installationToken } });
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.json().error.code, "installation_token_used");
    const tokenRow = (await pool.query("select * from installation_tokens")).rows[0];
    assert.ok(tokenRow.token_hash);
    assert.doesNotMatch(JSON.stringify(tokenRow), new RegExp(installationToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    for (const artifact of [prompt, JSON.stringify(subprocessArguments), installed.backupPath, repeated.body, ...capturedLogs]) {
      assert.doesNotMatch(artifact, /wb_live_/);
      assert.doesNotMatch(artifact, new RegExp(longLivedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  } finally {
    await app.close();
    await pool.end();
  }
});
