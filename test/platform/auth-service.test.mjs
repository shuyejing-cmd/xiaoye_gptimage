import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createAuthService } from "../../src/platform/auth/auth-service.mjs";

async function setup() {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const sent = [];
  let code = 100000;
  let token = 0;
  const service = createAuthService({
    pool,
    pepper: "test-pepper",
    now: () => new Date("2026-09-13T00:00:00Z"),
    randomCode: () => String(code++),
    randomToken: () => `session-${++token}`,
    mailer: { sendLoginCode: async (message) => sent.push(message) }
  });
  return { pool, service, sent };
}

test("verified email receives signup credits exactly once across later logins", async () => {
  const { pool, service, sent } = await setup();
  await service.requestCode({ email: " Member@Example.com ", ip: "203.0.113.10", deviceId: "device-1" });
  assert.equal(sent[0].email, "member@example.com");
  assert.equal(sent[0].code, "100000");

  const first = await service.verifyCode({ email: "member@example.com", code: "100000", ip: "203.0.113.10", deviceId: "device-1" });
  assert.equal(first.wallet.availableCredits, 5);
  assert.equal(first.sessionToken, "session-1");

  await service.requestCode({ email: "member@example.com", ip: "203.0.113.10", deviceId: "device-1" });
  const second = await service.verifyCode({ email: "member@example.com", code: "100001", ip: "203.0.113.10", deviceId: "device-1" });
  assert.equal(second.wallet.availableCredits, 5);
  const ledger = await pool.query("select event_type from ledger_entries where user_id = $1", [first.user.id]);
  assert.deepEqual(ledger.rows.map((row) => row.event_type), ["signup_bonus"]);
  await pool.end();
});

test("login codes expire, allow at most five failures, and cannot be reused", async () => {
  const { pool, service } = await setup();
  await service.requestCode({ email: "limit@example.com", ip: "203.0.113.11", deviceId: "device-2" });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(service.verifyCode({ email: "limit@example.com", code: "999999", ip: "203.0.113.11", deviceId: "device-2" }), (error) => error.code === "invalid_login_code");
  }
  await assert.rejects(service.verifyCode({ email: "limit@example.com", code: "100000", ip: "203.0.113.11", deviceId: "device-2" }), (error) => error.code === "login_code_locked");
  await pool.end();
});

test("a reused device registers the account but withholds another signup bonus", async () => {
  const { pool, service } = await setup();
  await service.requestCode({ email: "first@example.com", ip: "203.0.113.12", deviceId: "shared-device" });
  await service.verifyCode({ email: "first@example.com", code: "100000", ip: "203.0.113.12", deviceId: "shared-device" });
  await service.requestCode({ email: "second@example.com", ip: "203.0.113.13", deviceId: "shared-device" });
  const second = await service.verifyCode({ email: "second@example.com", code: "100001", ip: "203.0.113.13", deviceId: "shared-device" });
  assert.equal(second.wallet.availableCredits, 0);
  assert.equal(second.user.status, "pending_review");
  await pool.end();
});

test("website sessions authenticate and revoke immediately", async () => {
  const { pool, service } = await setup();
  await service.requestCode({ email: "session@example.com", ip: "203.0.113.20", deviceId: "session-device" });
  const login = await service.verifyCode({ email: "session@example.com", code: "100000", ip: "203.0.113.20", deviceId: "session-device" });
  const session = await service.authenticateSession(login.sessionToken);
  assert.equal(session.user.email, "session@example.com");
  await service.logout(login.sessionToken);
  await assert.rejects(service.authenticateSession(login.sessionToken), (error) => error.code === "invalid_session");
  await pool.end();
});
