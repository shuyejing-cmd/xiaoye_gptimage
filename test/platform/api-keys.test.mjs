import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createApiKeyService } from "../../src/platform/auth/api-key-service.mjs";
import { createPayloadCipher } from "../../src/platform/security/payload-cipher.mjs";

async function setup() {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const user = (await pool.query("insert into users(email,status,role) values('key@example.com','active','user') returning id")).rows[0];
  let seed = 1;
  const cipher = createPayloadCipher({ key: Buffer.alloc(32, 9) });
  const keys = createApiKeyService({ pool, pepper: "key-pepper", cipher, randomBytes: () => Buffer.alloc(24, seed++) });
  return { pool, userId: user.id, keys, cipher };
}

test("API key is encrypted at rest and can be revealed after recreating the service", async () => {
  const { pool, userId, keys, cipher } = await setup();
  const created = await keys.create({ userId, name: "WorkBuddy laptop" });
  assert.match(created.key, /^wb_live_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]+$/);
  const stored = (await pool.query("select * from api_keys where id=$1", [created.id])).rows[0];
  assert.equal(JSON.stringify(stored).includes(created.key), false);
  assert.match(stored.encrypted_key, /^v1\./);
  const authenticated = await keys.authenticate(created.key);
  assert.equal(authenticated.userId, userId);
  assert.equal(authenticated.role, "user");
  const recreated = createApiKeyService({ pool, pepper: "key-pepper", cipher });
  const listed = await recreated.list(userId);
  assert.equal(listed[0].key, created.key);
  assert.equal(listed[0].recoverable, true);
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
  const revoked = (await keys.list(userId)).find((key) => key.id === first.id);
  assert.equal(revoked.key, null);
  assert.equal(revoked.recoverable, false);
  await keys.create({ userId, name: "replacement" });
  await pool.end();
});

test("deleted keys disappear, lose their secret, and free an active-key slot", async () => {
  const { pool, userId, keys } = await setup();
  const first = await keys.create({ userId, name: "one" });
  await keys.create({ userId, name: "two" });
  await keys.create({ userId, name: "three" });

  const deleted = await keys.delete({ userId, keyId: first.id });
  assert.deepEqual(deleted, { id: first.id, deleted: true });
  await assert.rejects(keys.authenticate(first.key), (error) => error.code === "invalid_api_key");
  assert.equal((await keys.list(userId)).some((key) => key.id === first.id), false);

  const stored = (await pool.query("select * from api_keys where id=$1", [first.id])).rows[0];
  assert.equal(stored.status, "revoked");
  assert.equal(stored.encrypted_key, null);
  assert.ok(stored.deleted_at);
  await keys.create({ userId, name: "replacement" });

  assert.deepEqual(await keys.delete({ userId, keyId: first.id }), { id: first.id, deleted: true });
  assert.equal(Number((await pool.query("select count(*)::int as count from audit_events where action='delete_api_key' and target_id=$1", [String(first.id)])).rows[0].count), 1);
  await pool.end();
});

test("an imported legacy gateway token remains usable and becomes revealable", async () => {
  const { pool, userId, keys } = await setup();
  await keys.importLegacy({ userId, rawKey: "existing-private-admin-token" });
  assert.equal((await keys.authenticate("existing-private-admin-token")).userId, userId);
  assert.equal((await keys.list(userId))[0].key, "existing-private-admin-token");
  await pool.end();
});

test("a damaged encrypted value is never returned as a key", async () => {
  const { pool, userId, keys } = await setup();
  const created = await keys.create({ userId, name: "damaged" });
  await pool.query("update api_keys set encrypted_key='v1.invalid.invalid.invalid' where id=$1", [created.id]);
  const listed = await keys.list(userId);
  assert.equal(listed[0].key, null);
  assert.equal(listed[0].recoverable, false);
  await pool.end();
});
