import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createApiKeyService } from "../../src/platform/auth/api-key-service.mjs";

async function setup() {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const user = (await pool.query("insert into users(email,status,role) values('key@example.com','active','user') returning id")).rows[0];
  let seed = 1;
  const keys = createApiKeyService({ pool, pepper: "key-pepper", randomBytes: () => Buffer.alloc(24, seed++) });
  return { pool, userId: user.id, keys };
}

test("API key is shown once, stored as a digest, and authenticates its owner", async () => {
  const { pool, userId, keys } = await setup();
  const created = await keys.create({ userId, name: "WorkBuddy laptop" });
  assert.match(created.key, /^wb_live_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]+$/);
  const stored = (await pool.query("select * from api_keys where id=$1", [created.id])).rows[0];
  assert.equal(JSON.stringify(stored).includes(created.key), false);
  const authenticated = await keys.authenticate(created.key);
  assert.equal(authenticated.userId, userId);
  assert.equal(authenticated.role, "user");
  const listed = await keys.list(userId);
  assert.equal("key" in listed[0], false);
  await pool.end();
});

test("revoked keys fail immediately and a user can have at most three active keys", async () => {
  const { pool, userId, keys } = await setup();
  const first = await keys.create({ userId, name: "one" });
  await keys.create({ userId, name: "two" });
  await keys.create({ userId, name: "three" });
  await assert.rejects(keys.create({ userId, name: "four" }), (error) => error.code === "api_key_limit_reached");
  await keys.revoke({ userId, keyId: first.id });
  await assert.rejects(keys.authenticate(first.key), (error) => error.code === "invalid_api_key");
  await keys.create({ userId, name: "replacement" });
  await pool.end();
});

test("an imported legacy gateway token remains usable during migration", async () => {
  const { pool, userId, keys } = await setup();
  await keys.importLegacy({ userId, rawKey: "existing-private-admin-token" });
  assert.equal((await keys.authenticate("existing-private-admin-token")).userId, userId);
  await pool.end();
});
