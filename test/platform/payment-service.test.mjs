import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createPaymentService } from "../../src/platform/payments/payment-service.mjs";

const png = Buffer.from("89504e470d0a1a0a00000000", "hex");

async function setup() {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const user = (await pool.query("insert into users(email,status,role) values('buyer@example.com','active','user') returning id")).rows[0];
  const admin = (await pool.query("insert into users(email,status,role) values('admin@example.com','active','admin') returning id")).rows[0];
  await pool.query("insert into wallets(user_id,available_credits,held_credits) values($1,5,0),($2,0,0)", [user.id, admin.id]);
  const packageRow = (await pool.query("insert into recharge_packages(name,price_fen,credits) values('Starter',990,20) returning id")).rows[0];
  const stored = [];
  let order = 0;
  const service = createPaymentService({
    pool,
    now: () => new Date("2026-09-13T00:00:00Z"),
    orderNoFactory: () => `WB${++order}`,
    proofStore: { put: async (value) => { stored.push(value); return { objectKey: `proof/${value.orderNo}.png`, sha256: "abc" }; } }
  });
  return { pool, userId: user.id, adminId: admin.id, packageId: packageRow.id, service, stored };
}

test("recharge order preserves the selected package snapshot", async () => {
  const { pool, userId, packageId, service } = await setup();
  const order = await service.createOrder({ userId, packageId });
  await pool.query("update recharge_packages set price_fen=1990,credits=50 where id=$1", [packageId]);
  assert.deepEqual({ name: order.packageName, priceFen: order.priceFen, credits: order.credits, state: order.state }, { name: "Starter", priceFen: 990, credits: 20, state: "created" });
  await pool.end();
});

test("proof submission validates an image and moves the order to review", async () => {
  const { pool, userId, packageId, service, stored } = await setup();
  const order = await service.createOrder({ userId, packageId });
  const submitted = await service.submitProof({ userId, orderId: order.id, buffer: png, mimeType: "image/png", note: "paid" });
  assert.equal(submitted.state, "proof_submitted");
  assert.equal(stored.length, 1);
  await assert.rejects(service.submitProof({ userId, orderId: order.id, buffer: Buffer.from("text"), mimeType: "image/png" }), (error) => error.code === "invalid_payment_proof");
  await pool.end();
});

test("payment service delegates instructions and proof storage to its provider", async () => {
  const { pool, userId, packageId } = await setup();
  const calls = [];
  const service = createPaymentService({
    pool,
    now: () => new Date("2026-09-13T00:00:00Z"),
    orderNoFactory: () => "WBPROVIDER",
    paymentProvider: {
      name: "manual_qr",
      createInstructions: async () => [{ name: "微信", qr_url: "signed" }],
      submitProof: async (value) => { calls.push(value); return { objectKey: "proof/provider.png", sha256: "provider-sha" }; }
    }
  });
  assert.deepEqual(await service.createInstructions(), [{ name: "微信", qr_url: "signed" }]);
  const order = await service.createOrder({ userId, packageId });
  await service.submitProof({ userId, orderId: order.id, buffer: png, mimeType: "image/png" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].orderNo, "WBPROVIDER");
  assert.equal((await pool.query("select provider from recharge_orders where id=$1", [order.id])).rows[0].provider, "manual_qr");
  await pool.end();
});

test("approval credits the package and first recharge bonus exactly once", async () => {
  const { pool, userId, adminId, packageId, service } = await setup();
  const first = await service.createOrder({ userId, packageId });
  await service.submitProof({ userId, orderId: first.id, buffer: png, mimeType: "image/png" });
  await service.approve({ adminId, orderId: first.id });
  await service.approve({ adminId, orderId: first.id });
  let wallet = (await pool.query("select available_credits from wallets where user_id=$1", [userId])).rows[0];
  assert.equal(wallet.available_credits, 35);

  const second = await service.createOrder({ userId, packageId });
  await service.submitProof({ userId, orderId: second.id, buffer: png, mimeType: "image/png" });
  await service.approve({ adminId, orderId: second.id });
  wallet = (await pool.query("select available_credits from wallets where user_id=$1", [userId])).rows[0];
  assert.equal(wallet.available_credits, 55);
  const bonuses = await pool.query("select count(*)::int as count from ledger_entries where user_id=$1 and event_type='first_recharge_bonus'", [userId]);
  assert.equal(bonuses.rows[0].count, 1);
  assert.equal((await pool.query("select reason from audit_events where action='approve_recharge' and target_id=$1", [String(first.id)])).rows[0].reason, "管理员确认付款到账");
  await pool.end();
});

test("concurrent approval of one order credits the wallet only once", async () => {
  const { pool, userId, adminId, packageId, service } = await setup();
  const order = await service.createOrder({ userId, packageId });
  await service.submitProof({ userId, orderId: order.id, buffer: png, mimeType: "image/png" });
  const results = await Promise.all(Array.from({ length: 10 }, () => service.approve({ adminId, orderId: order.id })));
  assert.equal(results.every((item) => item.state === "approved"), true);
  assert.equal((await pool.query("select available_credits from wallets where user_id=$1", [userId])).rows[0].available_credits, 35);
  assert.equal(Number((await pool.query("select count(*)::int as count from ledger_entries where reference_type='recharge_order' and reference_id=$1", [String(order.id)])).rows[0].count), 1);
  await pool.end();
});

test("two concurrently approved first orders grant the first-recharge bonus once", async () => {
  const { pool, userId, adminId, packageId, service } = await setup();
  const first = await service.createOrder({ userId, packageId });
  const second = await service.createOrder({ userId, packageId });
  await service.submitProof({ userId, orderId: first.id, buffer: png, mimeType: "image/png" });
  await service.submitProof({ userId, orderId: second.id, buffer: png, mimeType: "image/png" });
  await Promise.all([service.approve({ adminId, orderId: first.id }), service.approve({ adminId, orderId: second.id })]);
  assert.equal((await pool.query("select available_credits from wallets where user_id=$1", [userId])).rows[0].available_credits, 55);
  assert.equal(Number((await pool.query("select count(*)::int as count from ledger_entries where event_type='first_recharge_bonus' and user_id=$1", [userId])).rows[0].count), 1);
  await pool.end();
});

test("created orders expire after 24 hours but submitted proofs remain reviewable", async () => {
  const { pool, userId, packageId, service } = await setup();
  const old = await service.createOrder({ userId, packageId });
  await pool.query("update recharge_orders set expires_at='2026-09-12T00:00:00Z' where id=$1", [old.id]);
  const expired = await service.expireCreatedOrders();
  assert.deepEqual(expired, [old.id]);
  assert.equal((await pool.query("select state from recharge_orders where id=$1", [old.id])).rows[0].state, "expired");
  await pool.end();
});
