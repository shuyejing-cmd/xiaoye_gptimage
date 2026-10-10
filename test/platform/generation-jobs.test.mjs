import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createPayloadCipher } from "../../src/platform/security/payload-cipher.mjs";
import { createGenerationJobs } from "../../src/platform/generation/generation-jobs.mjs";

async function setup() {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const user = (await pool.query("insert into users(email,status,role) values('jobs@example.com','active','user') returning id")).rows[0];
  await pool.query("insert into wallets(user_id,available_points,held_points) values($1,5,0)", [user.id]);
  let id = 0;
  const jobs = createGenerationJobs({
    pool,
    cipher: createPayloadCipher({ key: Buffer.alloc(32, 7) }),
    requestIdFactory: () => `request-${++id}`,
    now: () => new Date("2026-09-13T00:00:00Z")
  });
  return { pool, userId: user.id, jobs };
}

test("enqueue is idempotent and freezes one credit in the same operation", async () => {
  const { pool, userId, jobs } = await setup();
  const first = await jobs.enqueue({ userId, idempotencyKey: "idem-1", provider: "gpt_ge", request: { prompt: "orange cat" } });
  const duplicate = await jobs.enqueue({ userId, idempotencyKey: "idem-1", provider: "gpt_ge", request: { prompt: "different" } });
  assert.equal(duplicate.requestId, first.requestId);
  const wallet = (await pool.query("select available_points,held_points from wallets where user_id=$1", [userId])).rows[0];
  assert.deepEqual({ available: wallet.available_points, held: wallet.held_points }, { available: 0, held: 5 });
  assert.equal((await pool.query("select count(*)::int as count from generation_jobs")).rows[0].count, 1);
  await pool.end();
});

test("twenty concurrent requests with one idempotency key create one job and one hold", async () => {
  const { pool, userId, jobs } = await setup();
  const results = await Promise.all(Array.from({ length: 20 }, () => jobs.enqueue({ userId, idempotencyKey: "same-20", provider: "gpt_ge", request: { prompt: "cat" } })));
  assert.equal(new Set(results.map((result) => result.requestId)).size, 1);
  assert.equal(Number((await pool.query("select count(*)::int as count from generation_jobs")).rows[0].count), 1);
  assert.equal(Number((await pool.query("select count(*)::int as count from credit_holds")).rows[0].count), 1);
  assert.deepEqual((await jobs.getForUser({ userId, requestId: results[0].requestId })).wallet, { availablePoints: 0, heldPoints: 5 });
  await pool.end();
});

test("a user can have only one active generation while retries remain idempotent", async () => {
  const { pool, userId, jobs } = await setup();
  const first = await jobs.enqueue({ userId, idempotencyKey: "active-one", provider: "gpt_ge", request: { prompt: "one" } });
  assert.equal((await jobs.enqueue({ userId, idempotencyKey: "active-one", provider: "gpt_ge", request: { prompt: "retry" } })).requestId, first.requestId);
  await assert.rejects(
    jobs.enqueue({ userId, idempotencyKey: "active-two", provider: "gpt_ge", request: { prompt: "two" } }),
    (error) => error.code === "generation_concurrency_limit"
  );
  await pool.end();
});

test("success captures the hold only after an output object exists", async () => {
  const { pool, userId, jobs } = await setup();
  const job = await jobs.enqueue({ userId, idempotencyKey: "idem-success", provider: "gpt_ge", request: { prompt: "cat" } });
  await jobs.markOutputPersisting({ requestId: job.requestId, objectKey: "generated/request-1.png", mimeType: "image/png" });
  await jobs.succeed({ requestId: job.requestId });
  await jobs.succeed({ requestId: job.requestId });
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "succeeded");
  assert.equal(saved.encryptedPayload, null);
  assert.equal(saved.outputObjectKey, "generated/request-1.png");
  assert.deepEqual(saved.wallet, { availablePoints: 0, heldPoints: 0 });
  await pool.end();
});

test("explicit failure releases the hold while unknown keeps it frozen", async () => {
  const { pool, userId, jobs } = await setup();
  const failed = await jobs.enqueue({ userId, idempotencyKey: "idem-fail", provider: "gpt_ge", request: { prompt: "blocked" } });
  await jobs.fail({ requestId: failed.requestId, errorCode: "content_policy_violation" });
  assert.deepEqual((await jobs.getForUser({ userId, requestId: failed.requestId })).wallet, { availablePoints: 5, heldPoints: 0 });

  const unknown = await jobs.enqueue({ userId, idempotencyKey: "idem-unknown", provider: "gpt_ge", request: { prompt: "uncertain" } });
  await jobs.markUnknown({ requestId: unknown.requestId, errorCode: "provider_unreachable" });
  const saved = await jobs.getForUser({ userId, requestId: unknown.requestId });
  assert.equal(saved.state, "unknown");
  assert.deepEqual(saved.wallet, { availablePoints: 0, heldPoints: 5 });
  await pool.end();
});

test("a 2K editing job with two references snapshots and settles two points", async () => {
  const { pool, userId, jobs } = await setup();
  const job = await jobs.enqueue({ userId, idempotencyKey: "premium", provider: "apimart", request: { prompt: "edit", resolution: "2k" }, referenceObjectKeys: ["ref-1", "ref-2"] });
  assert.equal(job.pointsCost, 2);
  assert.equal(job.priceVersion, 2);
  assert.equal((await jobs.enqueue({ userId, idempotencyKey: "premium", provider: "apimart", request: { prompt: "other", quality: "low" } })).pointsCost, 2);
  assert.deepEqual((await jobs.getForUser({ userId, requestId: job.requestId })).wallet, { availablePoints: 3, heldPoints: 2 });
  await jobs.markOutputPersisting({ requestId: job.requestId, objectKey: "generated/premium.png", mimeType: "image/png", upstreamCost: 0.08123 });
  await jobs.succeed({ requestId: job.requestId });
  await jobs.succeed({ requestId: job.requestId });
  assert.deepEqual((await jobs.getForUser({ userId, requestId: job.requestId })).wallet, { availablePoints: 3, heldPoints: 0 });
  assert.equal((await pool.query("select upstream_cost_amount from generation_jobs where request_id=$1", [job.requestId])).rows[0].upstream_cost_amount, 0.08123);
  assert.deepEqual((await pool.query("select event_type,amount from ledger_entries where reference_type='generation' order by id")).rows.map((row) => [row.event_type, row.amount]), [["hold", -2], ["capture", -2]]);
  await pool.end();
});

test("a released hold cannot later become a free successful generation", async () => {
  const { pool, userId, jobs } = await setup();
  const job = await jobs.enqueue({ userId, idempotencyKey: "review-race", provider: "apimart", request: { prompt: "cat" } });
  await jobs.markOutputPersisting({ requestId: job.requestId, objectKey: "generated/review.png", mimeType: "image/png" });
  await jobs.fail({ requestId: job.requestId, errorCode: "manual_review_failed" });
  await assert.rejects(jobs.succeed({ requestId: job.requestId }), (error) => error.code === "generation_already_failed");
  assert.equal((await jobs.getForUser({ userId, requestId: job.requestId })).state, "failed");
  assert.deepEqual((await jobs.getForUser({ userId, requestId: job.requestId })).wallet, { availablePoints: 5, heldPoints: 0 });
  await pool.end();
});
