import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createWalletService } from "../../src/platform/billing/wallet-service.mjs";

async function setup(credits = 5) {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const user = (await pool.query("insert into users(email,status,role) values('wallet@example.com','active','user') returning id")).rows[0];
  await pool.query("insert into wallets(user_id,available_credits,held_credits) values($1,$2,0)", [user.id, credits]);
  const job = (await pool.query("insert into generation_jobs(request_id,user_id,idempotency_key,state,provider,encrypted_payload) values('req-wallet',$1,'idem-wallet','queued','gpt_ge','cipher') returning id", [user.id])).rows[0];
  return { pool, userId: user.id, generationId: job.id, wallet: createWalletService({ pool }) };
}

test("hold and capture settle exactly once", async () => {
  const { pool, userId, generationId, wallet } = await setup();
  assert.deepEqual(await wallet.hold({ userId, generationId }), { availableCredits: 4, heldCredits: 1 });
  assert.deepEqual(await wallet.hold({ userId, generationId }), { availableCredits: 4, heldCredits: 1 });
  assert.deepEqual(await wallet.capture({ generationId }), { availableCredits: 4, heldCredits: 0 });
  assert.deepEqual(await wallet.capture({ generationId }), { availableCredits: 4, heldCredits: 0 });
  const events = await pool.query("select event_type from ledger_entries order by id");
  assert.deepEqual(events.rows.map((row) => row.event_type), ["hold", "capture"]);
  await pool.end();
});

test("release returns a held credit exactly once", async () => {
  const { pool, userId, generationId, wallet } = await setup();
  await wallet.hold({ userId, generationId });
  assert.deepEqual(await wallet.release({ generationId }), { availableCredits: 5, heldCredits: 0 });
  assert.deepEqual(await wallet.release({ generationId }), { availableCredits: 5, heldCredits: 0 });
  await pool.end();
});

test("insufficient balance cannot create a hold", async () => {
  const { pool, userId, generationId, wallet } = await setup(0);
  await assert.rejects(wallet.hold({ userId, generationId }), (error) => error.code === "insufficient_credits");
  const holds = await pool.query("select count(*)::int as count from credit_holds");
  assert.equal(holds.rows[0].count, 0);
  await pool.end();
});

test("credit events are idempotent", async () => {
  const { pool, userId, wallet } = await setup(0);
  await wallet.credit({ userId, amount: 20, eventType: "recharge", referenceType: "recharge_order", referenceId: "order-1" });
  await wallet.credit({ userId, amount: 20, eventType: "recharge", referenceType: "recharge_order", referenceId: "order-1" });
  assert.deepEqual(await wallet.getBalance(userId), { availableCredits: 20, heldCredits: 0 });
  await pool.end();
});

test("admin adjustment changes balance through the ledger and requires a reason", async () => {
  const { pool, userId, wallet } = await setup(5);
  const adminId = (await pool.query("insert into users(email,status,role) values('wallet-admin@example.com','active','admin') returning id")).rows[0].id;
  await assert.rejects(async () => wallet.adjust({ userId, amount: 1, adminId, reason: "" }), (error) => error.code === "adjustment_reason_required");
  await wallet.adjust({ userId, amount: -2, adminId, reason: "测试纠错", referenceId: "adjust-1" });
  assert.deepEqual(await wallet.getBalance(userId), { availableCredits: 3, heldCredits: 0 });
  const entry = (await pool.query("select event_type,amount,metadata from ledger_entries where reference_id='adjust-1'")).rows[0];
  assert.deepEqual({ type: entry.event_type, amount: entry.amount }, { type: "admin_adjustment", amount: -2 });
  await pool.end();
});
