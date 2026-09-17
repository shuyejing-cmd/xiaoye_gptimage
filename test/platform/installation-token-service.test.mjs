import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createApiKeyService } from "../../src/platform/auth/api-key-service.mjs";
import { createPayloadCipher } from "../../src/platform/security/payload-cipher.mjs";
import { createInstallationTokenService } from "../../src/platform/installations/installation-token-service.mjs";

async function setup() {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const user = (await pool.query("insert into users(email,status,role) values('install@example.com','active','user') returning id")).rows[0];
  await pool.query("insert into wallets(user_id,available_credits,held_credits) values($1,5,0)", [user.id]);
  await pool.query("insert into sessions(id,user_id,token_hash,expires_at) values('session-1',$1,'session-hash','2026-09-16T00:00:00Z')", [user.id]);
  let keySeed = 1;
  let tokenSeed = 20;
  let now = new Date("2026-09-15T12:00:00Z");
  const apiKeyService = createApiKeyService({
    pool,
    pepper: "api-key-pepper",
    cipher: createPayloadCipher({ key: Buffer.alloc(32, 8) }),
    randomBytes: () => Buffer.alloc(24, keySeed++),
    now: () => now
  });
  const key = await apiKeyService.create({ userId: user.id, name: "Installer" });
  const service = createInstallationTokenService({
    pool,
    pepper: "installation-token-pepper",
    apiKeyService,
    randomBytes: () => Buffer.alloc(24, tokenSeed++),
    now: () => now
  });
  return { pool, userId: user.id, apiKeyService, key, service, setNow: (value) => { now = value; } };
}

test("an installation token is stored as a digest and exchanged only once", async () => {
  const { pool, userId, key, service } = await setup();
  const issued = await service.create({ userId, sessionId: "session-1", apiKeyId: key.id });
  assert.match(issued.token, /^wb_install_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]+$/);
  assert.equal(new Date(issued.expiresAt).toISOString(), "2026-09-15T12:30:00.000Z");
  assert.equal(JSON.stringify((await pool.query("select * from installation_tokens")).rows).includes(issued.token), false);

  const results = await Promise.allSettled(Array.from({ length: 20 }, () => service.exchange(issued.token)));
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0].value.apiKey, key.key);
  assert.equal(fulfilled[0].value.userId, userId);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "installation_token_used").length, 19);
  await pool.end();
});

test("expired, revoked-session, revoked-key, and suspended-account tokens are rejected", async () => {
  const { pool, userId, apiKeyService, key, service, setNow } = await setup();

  const expired = await service.create({ userId, sessionId: "session-1", apiKeyId: key.id });
  setNow(new Date("2026-09-15T12:29:59Z"));
  assert.equal((await service.exchange(expired.token)).apiKey, key.key);

  setNow(new Date("2026-09-15T12:00:00Z"));
  const expiredAtBoundary = await service.create({ userId, sessionId: "session-1", apiKeyId: key.id });
  setNow(new Date("2026-09-15T12:30:00Z"));
  await assert.rejects(service.exchange(expiredAtBoundary.token), (error) => error.code === "installation_token_expired");

  setNow(new Date("2026-09-15T12:00:00Z"));
  const loggedOut = await service.create({ userId, sessionId: "session-1", apiKeyId: key.id });
  await pool.query("update sessions set revoked_at=$1 where id='session-1'", [new Date("2026-09-15T12:01:00Z")]);
  await assert.rejects(service.exchange(loggedOut.token), (error) => error.code === "invalid_session");

  await pool.query("update sessions set revoked_at=null where id='session-1'");
  const revokedKey = await service.create({ userId, sessionId: "session-1", apiKeyId: key.id });
  await apiKeyService.revoke({ userId, keyId: key.id });
  await assert.rejects(service.exchange(revokedKey.token), (error) => error.code === "api_key_invalid");

  const replacement = await apiKeyService.create({ userId, name: "Replacement" });
  const suspended = await service.create({ userId, sessionId: "session-1", apiKeyId: replacement.id });
  await pool.query("update users set status='suspended' where id=$1", [userId]);
  await assert.rejects(service.exchange(suspended.token), (error) => error.code === "account_suspended");
  await pool.end();
});

test("a user can retain at most five unexpired installation tokens", async () => {
  const { pool, userId, key, service } = await setup();
  for (let index = 0; index < 5; index += 1) await service.create({ userId, sessionId: "session-1", apiKeyId: key.id });
  await assert.rejects(service.create({ userId, sessionId: "session-1", apiKeyId: key.id }), (error) => error.code === "installation_token_limit_reached");
  assert.equal(Number((await pool.query("select count(id)::int count from audit_events where action='create_installation_token'")).rows[0].count), 5);
  await pool.end();
});

test("deleting a key invalidates its unconsumed installation token", async () => {
  const { pool, userId, apiKeyService, key, service } = await setup();
  const issued = await service.create({ userId, sessionId: "session-1", apiKeyId: key.id });
  await apiKeyService.delete({ userId, keyId: key.id });
  await assert.rejects(service.exchange(issued.token), (error) => error.code === "api_key_invalid");
  await pool.end();
});
