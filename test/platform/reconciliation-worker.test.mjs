import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createPayloadCipher } from "../../src/platform/security/payload-cipher.mjs";
import { createGenerationJobs } from "../../src/platform/generation/generation-jobs.mjs";
import { createReconciliationWorker } from "../../src/platform/generation/reconciliation-worker.mjs";

async function setup(now = new Date("2026-09-13T12:00:00Z")) {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const user = (await pool.query("insert into users(email,status,role) values('reconcile@example.com','active','user') returning id")).rows[0];
  await pool.query("insert into wallets(user_id,available_credits,held_credits) values($1,5,0)", [user.id]);
  const jobs = createGenerationJobs({ pool, cipher: createPayloadCipher({ key: Buffer.alloc(32, 7) }), requestIdFactory: () => "reconcile-1", now: () => now });
  return { pool, userId: user.id, jobs };
}

test("reconciliation captures an output already stored before a database settlement crash", async () => {
  const { pool, userId, jobs } = await setup();
  const job = await jobs.enqueue({ userId, idempotencyKey: "stored", provider: "gpt_ge", request: { prompt: "cat" } });
  await jobs.markOutputPersisting({ requestId: job.requestId, objectKey: "generated/reconcile-1.png", mimeType: "image/png" });
  const worker = createReconciliationWorker({ jobs, outputStore: { exists: async () => true }, providers: {} });
  await worker.runOnce();
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "succeeded");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 0 });
  await pool.end();
});

test("reconciliation polls an existing upstream task and never resubmits it", async () => {
  const { pool, userId, jobs } = await setup();
  const job = await jobs.enqueue({ userId, idempotencyKey: "pending", provider: "apimart", request: { prompt: "cat" } });
  await jobs.claimNext();
  await jobs.markProviderPending({ requestId: job.requestId, upstreamTaskId: "upstream-7" });
  let getCalls = 0;
  const provider = {
    getTask: async (taskId) => { getCalls += 1; assert.equal(taskId, "upstream-7"); return { status: "completed", imageUrl: "https://provider.example/output.png" }; },
    submit: async () => { throw new Error("must not submit"); }
  };
  const outputStore = { putGeneratedFromUrl: async ({ requestId }) => ({ objectKey: `generated/${requestId}.png`, mimeType: "image/png" }) };
  const worker = createReconciliationWorker({ jobs, providers: { apimart: provider }, outputStore });
  await worker.runOnce();
  assert.equal(getCalls, 1);
  assert.equal((await jobs.getForUser({ userId, requestId: job.requestId })).state, "succeeded");
  await pool.end();
});

test("unknown task without upstream id remains held and moves to manual review after 24 hours", async () => {
  const now = new Date("2026-09-14T12:00:01Z");
  const { pool, userId, jobs } = await setup(now);
  const job = await jobs.enqueue({ userId, idempotencyKey: "unknown", provider: "gpt_ge", request: { prompt: "cat" }, referenceObjectKeys: ["private/ref.png"] });
  await jobs.markUnknown({ requestId: job.requestId, errorCode: "provider_unreachable" });
  await pool.query("update generation_jobs set unknown_since='2026-09-13T12:00:00Z' where request_id=$1", [job.requestId]);
  const notified = [];
  const removed = [];
  const worker = createReconciliationWorker({ jobs, providers: {}, outputStore: { remove: async (key) => removed.push(key) }, notifyManualReview: async (ids) => notified.push(...ids), now: () => now });
  await worker.runOnce();
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "manual_review");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 1 });
  assert.deepEqual(notified, [job.requestId]);
  assert.deepEqual(removed, ["private/ref.png"]);
  assert.equal((await pool.query("select encrypted_payload from generation_jobs where request_id=$1", [job.requestId])).rows[0].encrypted_payload, null);
  await pool.end();
});

test("reconciliation finds a deterministic output left by a pre-settlement crash", async () => {
  const { pool, userId, jobs } = await setup();
  const job = await jobs.enqueue({ userId, idempotencyKey: "uploaded-before-db", provider: "gpt_ge", request: { prompt: "cat" } });
  await jobs.claimNext();
  await pool.query("update generation_jobs set updated_at='2026-09-13T11:00:00Z' where request_id=$1", [job.requestId]);
  const outputStore = {
    findGenerated: async (requestId) => requestId === job.requestId ? { objectKey: `generated/${requestId}.png`, mimeType: "image/png" } : null,
    exists: async () => true
  };
  const worker = createReconciliationWorker({ jobs, providers: {}, outputStore });
  await worker.runOnce();
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "succeeded");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 0 });
  await pool.end();
});

test("an unknown COS upload is captured if its deterministic object exists", async () => {
  const { pool, userId, jobs } = await setup();
  const job = await jobs.enqueue({ userId, idempotencyKey: "uncertain-cos-upload", provider: "gpt_ge", request: { prompt: "cat" } });
  await jobs.claimNext();
  await jobs.markUnknown({ requestId: job.requestId, errorCode: "output_persist_failed" });
  const worker = createReconciliationWorker({
    jobs,
    providers: {},
    outputStore: {
      findGenerated: async () => ({ objectKey: `generated/${job.requestId}.webp`, mimeType: "image/webp" }),
      exists: async () => true
    }
  });
  await worker.runOnce();
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "succeeded");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 0 });
  await pool.end();
});

test("an interrupted submission without an output becomes unknown and is never resubmitted", async () => {
  const now = new Date("2026-09-13T12:00:00Z");
  const { pool, userId, jobs } = await setup(now);
  const job = await jobs.enqueue({ userId, idempotencyKey: "interrupted-submit", provider: "apimart", request: { prompt: "cat" } });
  await jobs.claimNext();
  await pool.query("update generation_jobs set updated_at='2026-09-13T11:00:00Z' where request_id=$1", [job.requestId]);
  let submitCalls = 0;
  const worker = createReconciliationWorker({
    jobs,
    providers: { apimart: { submit: async () => { submitCalls += 1; } } },
    outputStore: { findGenerated: async () => null },
    now: () => now
  });
  await worker.runOnce();
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "unknown");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 1 });
  assert.equal(submitCalls, 0);
  await pool.end();
});

test("a provider task still pending after 24 hours enters manual review", async () => {
  const now = new Date("2026-09-14T12:00:01Z");
  const { pool, userId, jobs } = await setup(now);
  const job = await jobs.enqueue({ userId, idempotencyKey: "stale-provider", provider: "apimart", request: { prompt: "cat" } });
  await jobs.claimNext();
  await jobs.markProviderPending({ requestId: job.requestId, upstreamTaskId: "upstream-stale" });
  await pool.query("update generation_jobs set updated_at='2026-09-13T12:00:00Z' where request_id=$1", [job.requestId]);
  const notified = [];
  const worker = createReconciliationWorker({
    jobs,
    providers: { apimart: { getTask: async () => ({ status: "pending" }) } },
    outputStore: {},
    notifyManualReview: async (ids) => notified.push(...ids),
    now: () => now
  });
  await worker.runOnce();
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "manual_review");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 1 });
  assert.deepEqual(notified, [job.requestId]);
  await pool.end();
});
