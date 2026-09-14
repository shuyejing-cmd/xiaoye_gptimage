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
  await pool.query("insert into wallets(user_id,available_credits,held_credits) values($1,5,0)", [user.id]);
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
  const wallet = (await pool.query("select available_credits,held_credits from wallets where user_id=$1", [userId])).rows[0];
  assert.deepEqual({ available: wallet.available_credits, held: wallet.held_credits }, { available: 4, held: 1 });
  assert.equal((await pool.query("select count(*)::int as count from generation_jobs")).rows[0].count, 1);
  await pool.end();
});

test("twenty concurrent requests with one idempotency key create one job and one hold", async () => {
  const { pool, userId, jobs } = await setup();
  const results = await Promise.all(Array.from({ length: 20 }, () => jobs.enqueue({ userId, idempotencyKey: "same-20", provider: "gpt_ge", request: { prompt: "cat" } })));
  assert.equal(new Set(results.map((result) => result.requestId)).size, 1);
  assert.equal(Number((await pool.query("select count(*)::int as count from generation_jobs")).rows[0].count), 1);
  assert.equal(Number((await pool.query("select count(*)::int as count from credit_holds")).rows[0].count), 1);
  assert.deepEqual((await jobs.getForUser({ userId, requestId: results[0].requestId })).wallet, { availableCredits: 4, heldCredits: 1 });
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
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 0 });
  await pool.end();
});

test("explicit failure releases the hold while unknown keeps it frozen", async () => {
  const { pool, userId, jobs } = await setup();
  const failed = await jobs.enqueue({ userId, idempotencyKey: "idem-fail", provider: "gpt_ge", request: { prompt: "blocked" } });
  await jobs.fail({ requestId: failed.requestId, errorCode: "content_policy_violation" });
  assert.deepEqual((await jobs.getForUser({ userId, requestId: failed.requestId })).wallet, { availableCredits: 5, heldCredits: 0 });

  const unknown = await jobs.enqueue({ userId, idempotencyKey: "idem-unknown", provider: "gpt_ge", request: { prompt: "uncertain" } });
  await jobs.markUnknown({ requestId: unknown.requestId, errorCode: "provider_unreachable" });
  const saved = await jobs.getForUser({ userId, requestId: unknown.requestId });
  assert.equal(saved.state, "unknown");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 1 });
  await pool.end();
});
