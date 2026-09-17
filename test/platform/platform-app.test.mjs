import test from "node:test";
import assert from "node:assert/strict";
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

async function setup({ publicRegistrationEnabled = true, cookieSecure = true, releaseService = { getStatus: async () => ({ ready: true, version: "1.2.0", manifest_url: "https://github.com/owner/repository/releases/download/v1.2.0/workbuddy-image-mcp-1.2.0.json" }) } } = {}) {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const sent = [];
  let code = 200000;
  let requestId = 0;
  let keySeed = 1;
  let tokenSeed = 20;
  const authService = createAuthService({ pool, pepper: "auth", randomCode: () => String(code++), randomToken: () => `token-${code}`, mailer: { sendLoginCode: async (value) => sent.push(value) } });
  const apiKeyService = createApiKeyService({ pool, pepper: "keys", cipher: createPayloadCipher({ key: Buffer.alloc(32, 7) }), randomBytes: () => Buffer.alloc(24, keySeed++) });
  const walletService = createWalletService({ pool });
  const generationJobs = createGenerationJobs({ pool, cipher: createPayloadCipher({ key: Buffer.alloc(32, 4) }), requestIdFactory: () => `api-${++requestId}` });
  const installationTokenService = createInstallationTokenService({ pool, pepper: "installation-tokens", apiKeyService, randomBytes: () => Buffer.alloc(24, tokenSeed++) });
  const app = createPlatformApp({ pool, authService, apiKeyService, installationTokenService, releaseService, walletService, generationJobs, rateLimiter: createRateLimiter({ pool }), temporaryStore: { putReference: async () => ({ objectKey: "private/reference.png" }) }, publicRegistrationEnabled, cookieSecure, publicOrigin: "https://xiaoyeai.cn", installerVersion: "1.2.0", readyCheck: async () => true });
  return { pool, app, sent };
}

function multipartPayload(boundary, parts) {
  return Buffer.concat(parts.flatMap((part) => [
    Buffer.from(`--${boundary}\r\n${part.headers}\r\n\r\n`),
    Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body),
    Buffer.from("\r\n")
  ]).concat(Buffer.from(`--${boundary}--\r\n`)));
}

async function login(app, sent, email, deviceId) {
  await app.inject({ method: "POST", url: "/api/auth/email-code", payload: { email, device_id: deviceId } });
  const response = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { email, code: sent.at(-1).code, device_id: deviceId } });
  assert.equal(response.statusCode, 200);
  return { cookie: response.headers["set-cookie"].split(";")[0], body: response.json() };
}

test("email login creates a secure website session and exposes the wallet", async () => {
  const { pool, app, sent } = await setup();
  const loginResult = await login(app, sent, "web@example.com", "browser-1");
  assert.match(loginResult.cookie, /^wb_session=/);
  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: loginResult.cookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.email, "web@example.com");
  assert.deepEqual(me.json().wallet, { available_credits: 5, held_credits: 0 });
  await app.close();
  await pool.end();
});

test("local HTTP login can omit the Secure cookie attribute when explicitly configured", async () => {
  const { pool, app, sent } = await setup({ cookieSecure: false });
  await app.inject({ method: "POST", url: "/api/auth/email-code", payload: { email: "local@example.com", device_id: "local-browser" } });
  const response = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { email: "local@example.com", code: sent.at(-1).code, device_id: "local-browser" } });
  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.headers["set-cookie"], /;\s*Secure/i);
  await app.close();
  await pool.end();
});

test("closed registration still allows existing users to request a login code", async () => {
  const { pool, app, sent } = await setup({ publicRegistrationEnabled: false });
  const existing = (await pool.query("insert into users(email,status,role) values('existing@example.com','active','user') returning id")).rows[0];
  await pool.query("insert into wallets(user_id,available_credits,held_credits) values($1,5,0)", [existing.id]);
  const allowed = await app.inject({ method: "POST", url: "/api/auth/email-code", payload: { email: "existing@example.com", device_id: "existing-browser" } });
  const closed = await app.inject({ method: "POST", url: "/api/auth/email-code", payload: { email: "new@example.com", device_id: "new-browser" } });
  assert.equal(allowed.statusCode, 202);
  assert.equal(closed.statusCode, 403);
  assert.equal(closed.json().error.code, "registration_closed");
  assert.equal(sent.length, 1);
  await app.close();
  await pool.end();
});

test("personal API key creates one idempotent billed job", async () => {
  const { pool, app, sent } = await setup();
  const loginResult = await login(app, sent, "generator@example.com", "browser-2");
  const createdKey = await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: loginResult.cookie }, payload: { name: "Laptop" } });
  assert.equal(createdKey.statusCode, 201);
  const key = createdKey.json().key;
  const request = { method: "POST", url: "/v1/generations", headers: { authorization: `Bearer ${key}`, "idempotency-key": "same-request" }, payload: { prompt: "orange cat" } };
  const first = await app.inject(request);
  const duplicate = await app.inject(request);
  assert.equal(first.statusCode, 202);
  assert.equal(duplicate.json().request_id, first.json().request_id);
  const balance = await app.inject({ method: "GET", url: "/v1/account/balance", headers: { authorization: `Bearer ${key}` } });
  assert.deepEqual(balance.json(), { available_credits: 4, held_credits: 1 });
  await app.close();
  await pool.end();
});

test("an authenticated owner can reload a complete key without cache storage", async () => {
  const { pool, app, sent } = await setup();
  const owner = await login(app, sent, "persistent-key@example.com", "persistent-key-browser");
  const created = await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: owner.cookie }, payload: { name: "Persistent" } });
  const listed = await app.inject({ method: "GET", url: "/api/api-keys", headers: { cookie: owner.cookie } });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.headers["cache-control"], "no-store");
  assert.equal(listed.json().keys[0].key, created.json().key);
  await app.close();
  await pool.end();
});

test("an owner can idempotently delete a key and create a replacement", async () => {
  const { pool, app, sent } = await setup();
  const owner = await login(app, sent, "delete-owner@example.com", "delete-owner-browser");
  const other = await login(app, sent, "delete-other@example.com", "delete-other-browser");
  const created = [];
  for (const name of ["one", "two", "three"]) {
    const response = await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: owner.cookie }, payload: { name } });
    assert.equal(response.statusCode, 201);
    created.push(response.json());
  }

  const hidden = await app.inject({ method: "DELETE", url: `/api/api-keys/${created[0].id}`, headers: { cookie: other.cookie } });
  assert.equal(hidden.statusCode, 404);
  assert.equal(hidden.json().error.code, "api_key_not_found");

  const firstDelete = await app.inject({ method: "DELETE", url: `/api/api-keys/${created[0].id}`, headers: { cookie: owner.cookie } });
  const repeatedDelete = await app.inject({ method: "DELETE", url: `/api/api-keys/${created[0].id}`, headers: { cookie: owner.cookie } });
  assert.equal(firstDelete.statusCode, 200);
  assert.deepEqual(firstDelete.json(), { id: created[0].id, deleted: true });
  assert.equal(repeatedDelete.statusCode, 200);
  assert.deepEqual(repeatedDelete.json(), { id: created[0].id, deleted: true });

  const listed = await app.inject({ method: "GET", url: "/api/api-keys", headers: { cookie: owner.cookie } });
  assert.equal(listed.json().keys.some((key) => key.id === created[0].id), false);
  const replacement = await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: owner.cookie }, payload: { name: "replacement" } });
  assert.equal(replacement.statusCode, 201);
  await app.close();
  await pool.end();
});

test("an owner can issue a prompt and exchange its one-time installation token", async () => {
  const { pool, app, sent } = await setup();
  const owner = await login(app, sent, "installer-owner@example.com", "installer-owner-browser");
  const other = await login(app, sent, "installer-other@example.com", "installer-other-browser");
  const created = await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: owner.cookie }, payload: { name: "Installer" } });

  assert.equal((await app.inject({ method: "POST", url: `/api/api-keys/${created.json().id}/installation-token` })).statusCode, 401);
  const hidden = await app.inject({ method: "POST", url: `/api/api-keys/${created.json().id}/installation-token`, headers: { cookie: other.cookie } });
  assert.equal(hidden.statusCode, 401);
  assert.equal(hidden.json().error.code, "api_key_invalid");

  const issued = await app.inject({ method: "POST", url: `/api/api-keys/${created.json().id}/installation-token`, headers: { cookie: owner.cookie } });
  assert.equal(issued.statusCode, 201);
  assert.equal(issued.headers["cache-control"], "no-store");
  assert.match(issued.json().prompt, /wb_install_/);
  assert.doesNotMatch(issued.json().prompt, /wb_live_/);
  const token = issued.json().prompt.match(/wb_install_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+/)[0];

  const exchanged = await app.inject({ method: "POST", url: "/v1/installations/exchange", payload: { installation_token: token } });
  assert.equal(exchanged.statusCode, 200);
  assert.equal(exchanged.headers["cache-control"], "no-store");
  assert.equal(exchanged.json().api_key, created.json().key);
  assert.equal(exchanged.json().gateway_url, "https://xiaoyeai.cn");
  const repeated = await app.inject({ method: "POST", url: "/v1/installations/exchange", payload: { installation_token: token } });
  assert.equal(repeated.statusCode, 409);
  assert.equal(repeated.json().error.code, "installation_token_used");
  await app.close();
  await pool.end();
});

test("release status is visible to the user and unavailable releases block token issuance", async () => {
  const releaseService = { getStatus: async () => ({ ready: false, version: "1.2.0", manifest_url: null, message: "安装服务准备中" }) };
  const { pool, app, sent } = await setup({ releaseService });
  const owner = await login(app, sent, "release-owner@example.com", "release-browser");
  const status = await app.inject({ method: "GET", url: "/api/install-release/status", headers: { cookie: owner.cookie } });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.json(), await releaseService.getStatus());
  const created = await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: owner.cookie }, payload: { name: "Installer" } });
  const issued = await app.inject({ method: "POST", url: `/api/api-keys/${created.json().id}/installation-token`, headers: { cookie: owner.cookie } });
  assert.equal(issued.statusCode, 503);
  assert.equal(issued.json().error.code, "installer_release_unavailable");
  assert.equal((await pool.query("select count(*)::int as count from installation_tokens")).rows[0].count, 0);
  await app.close();
  await pool.end();
});

test("installation prompt issuance is limited to three requests per user per minute", async () => {
  const { pool, app, sent } = await setup();
  const owner = await login(app, sent, "installer-limit@example.com", "installer-limit-browser");
  const created = await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: owner.cookie }, payload: { name: "Installer" } });
  const responses = [];
  for (let index = 0; index < 4; index += 1) responses.push(await app.inject({ method: "POST", url: `/api/api-keys/${created.json().id}/installation-token`, headers: { cookie: owner.cookie } }));
  assert.deepEqual(responses.map((response) => response.statusCode), [201, 201, 201, 429]);
  assert.equal(responses[3].json().error.code, "rate_limit_exceeded");
  await app.close();
  await pool.end();
});

test("logging out invalidates an installation token", async () => {
  const { pool, app, sent } = await setup();
  const owner = await login(app, sent, "installer-logout@example.com", "installer-logout-browser");
  const created = await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: owner.cookie }, payload: { name: "Installer" } });
  const issued = await app.inject({ method: "POST", url: `/api/api-keys/${created.json().id}/installation-token`, headers: { cookie: owner.cookie } });
  const token = issued.json().prompt.match(/wb_install_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+/)[0];
  await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: owner.cookie } });
  const exchanged = await app.inject({ method: "POST", url: "/v1/installations/exchange", payload: { installation_token: token } });
  assert.equal(exchanged.statusCode, 401);
  assert.equal(exchanged.json().error.code, "invalid_session");
  await app.close();
  await pool.end();
});

test("one user cannot read another user's generation", async () => {
  const { pool, app, sent } = await setup();
  const one = await login(app, sent, "one@example.com", "browser-one");
  const two = await login(app, sent, "two@example.com", "browser-two");
  const keyOne = (await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: one.cookie }, payload: { name: "one" } })).json().key;
  const keyTwo = (await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: two.cookie }, payload: { name: "two" } })).json().key;
  const created = await app.inject({ method: "POST", url: "/v1/generations", headers: { authorization: `Bearer ${keyOne}`, "idempotency-key": "private" }, payload: { prompt: "private" } });
  const hidden = await app.inject({ method: "GET", url: `/v1/generations/${created.json().request_id}`, headers: { authorization: `Bearer ${keyTwo}` } });
  assert.equal(hidden.statusCode, 404);
  await app.close();
  await pool.end();
});

test("commercial generation API rejects a reference image larger than 4 MiB", async () => {
  const { pool, app, sent } = await setup();
  const loggedIn = await login(app, sent, "large-image@example.com", "browser-large");
  const key = (await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: loggedIn.cookie }, payload: { name: "large" } })).json().key;
  const boundary = "platform-large-boundary";
  const response = await app.inject({
    method: "POST",
    url: "/v1/generations",
    headers: { authorization: `Bearer ${key}`, "idempotency-key": "large-image", "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: multipartPayload(boundary, [
      { headers: 'Content-Disposition: form-data; name="request"', body: JSON.stringify({ prompt: "cat" }) },
      { headers: 'Content-Disposition: form-data; name="image"; filename="large.png"\r\nContent-Type: image/png', body: Buffer.alloc(4 * 1024 * 1024 + 1) }
    ])
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "reference_image_too_large");
  await app.close();
  await pool.end();
});

test("website and admin APIs enforce sessions, roles, and order isolation", async () => {
  const { pool, app, sent } = await setup();
  assert.equal((await app.inject({ method: "GET", url: "/api/wallet" })).statusCode, 401);
  const one = await login(app, sent, "orders-one@example.com", "orders-one");
  const two = await login(app, sent, "orders-two@example.com", "orders-two");
  const forbidden = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: one.cookie } });
  assert.equal(forbidden.statusCode, 403);
  const pack = (await pool.query("insert into recharge_packages(name,price_fen,credits) values('Private',1000,10) returning id")).rows[0];
  await pool.query("insert into recharge_orders(order_no,user_id,package_id,provider,package_name,price_fen,credits,state,expires_at) values('WBPRIVATE',$1,$2,'manual_qr','Private',1000,10,'created',$3)", [one.body.user.id, pack.id, new Date("2026-09-15T00:00:00Z")]);
  const ownOrders = await app.inject({ method: "GET", url: "/api/recharge-orders", headers: { cookie: one.cookie } });
  const otherOrders = await app.inject({ method: "GET", url: "/api/recharge-orders", headers: { cookie: two.cookie } });
  assert.equal(ownOrders.json().orders.length, 1);
  assert.equal(otherOrders.json().orders.length, 0);
  const keyTwo = (await app.inject({ method: "POST", url: "/api/api-keys", headers: { cookie: two.cookie }, payload: { name: "to-suspend" } })).json().key;
  await pool.query("update users set role='admin' where id=$1", [one.body.user.id]);
  const suspended = await app.inject({ method: "PATCH", url: `/api/admin/users/${two.body.user.id}`, headers: { cookie: one.cookie }, payload: { status: "suspended", reason: "自动化冻结测试" } });
  assert.equal(suspended.statusCode, 200);
  const rejectedKey = await app.inject({ method: "GET", url: "/v1/account/balance", headers: { authorization: `Bearer ${keyTwo}` } });
  assert.equal(rejectedKey.statusCode, 401);
  assert.equal((await pool.query("select reason from audit_events where action='change_user_status' and target_id=$1", [String(two.body.user.id)])).rows[0].reason, "自动化冻结测试");
  await app.close();
  await pool.end();
});
