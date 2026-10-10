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
  await pool.query("insert into wallets(user_id,available_points,held_points) values($1,5,0)", [user.id]);
  let requestSequence = 0;
  const jobs = createGenerationJobs({ pool, cipher: createPayloadCipher({ key: Buffer.alloc(32, 7) }), requestIdFactory: () => `reconcile-${++requestSequence}`, now: () => now });
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
  assert.deepEqual(saved.wallet, { availablePoints: 0, heldPoints: 0 });
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

test("reconciliation downloads APIMart output with its provider transport before storing it", async () => {
  const { pool, userId, jobs } = await setup();
  const job = await jobs.enqueue({ userId, idempotencyKey: "proxied-output", provider: "apimart", request: { prompt: "cat" } });
  await jobs.claimNext();
  await jobs.markProviderPending({ requestId: job.requestId, upstreamTaskId: "upstream-proxy" });
  let downloadedUrl;
  let storedBuffer;
  const provider = {
    getTask: async () => ({ status: "completed", imageUrl: "https://cdn.apimart.ai/output.png" }),
    downloadImage: async (url) => { downloadedUrl = url; return { imageBuffer: Buffer.from("png"), mimeType: "image/png" }; }
  };
  const outputStore = {
    putGenerated: async ({ buffer, requestId, mimeType }) => { storedBuffer = buffer; return { objectKey: `generated/${requestId}.png`, mimeType }; }
  };
  const worker = createReconciliationWorker({ jobs, providers: { apimart: provider }, outputStore });
  await worker.runOnce();
  assert.equal(downloadedUrl, "https://cdn.apimart.ai/output.png");
  assert.equal(storedBuffer.toString(), "png");
  assert.equal((await jobs.getForUser({ userId, requestId: job.requestId })).state, "succeeded");
  await pool.end();
});

test("reconciliation selects the provider recorded on each historical job", async () => {
  const { pool, userId, jobs } = await setup();
  const apimartJob = await jobs.enqueue({ userId, idempotencyKey: "historical-apimart", provider: "apimart", request: { prompt: "cat" } });
  await jobs.claimNext();
  await jobs.markProviderPending({ requestId: apimartJob.requestId, upstreamTaskId: "apimart-task" });
  await pool.query("update generation_jobs set state='failed' where request_id=$1", [apimartJob.requestId]);
  await pool.query("update wallets set available_points=5,held_points=0 where user_id=$1", [userId]);
  const gptJob = await jobs.enqueue({ userId, idempotencyKey: "historical-gpt", provider: "gpt_ge", request: { prompt: "dog" } });
  await jobs.claimNext();
  await jobs.markProviderPending({ requestId: gptJob.requestId, upstreamTaskId: "gpt-task" });
  await pool.query("update generation_jobs set state='provider_pending' where request_id=$1", [apimartJob.requestId]);
  const calls = [];
  const providers = {
    apimart: { getTask: async (id) => { calls.push(["apimart", id]); return { status: "pending" }; } },
    gpt_ge: { getTask: async (id) => { calls.push(["gpt_ge", id]); return { status: "pending" }; } }
  };
  await createReconciliationWorker({ jobs, providers, outputStore: {} }).runOnce();
  assert.deepEqual(calls.sort(), [["apimart", "apimart-task"], ["gpt_ge", "gpt-task"]]);
  await pool.end();
});

test("unknown task without upstream id remains held and moves to manual review after 24 hours", async () => {
  const now = new Date("2026-09-14T12:00:01Z");
  const { pool, userId, jobs } = await setup(now);
  await pool.query("update wallets set available_points=10 where user_id=$1", [userId]);
  const job = await jobs.enqueue({ userId, idempotencyKey: "unknown", provider: "gpt_ge", request: { prompt: "cat" }, referenceObjectKeys: ["private/ref.png"] });
  await jobs.markUnknown({ requestId: job.requestId, errorCode: "provider_unreachable" });
  await pool.query("update generation_jobs set unknown_since='2026-09-13T12:00:00Z' where request_id=$1", [job.requestId]);
  const notified = [];
  const removed = [];
  const worker = createReconciliationWorker({ jobs, providers: {}, outputStore: { remove: async (key) => removed.push(key) }, notifyManualReview: async (ids) => notified.push(...ids), now: () => now });
  await worker.runOnce();
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "manual_review");
  assert.deepEqual(saved.wallet, { availablePoints: 0, heldPoints: 10 });
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
  assert.deepEqual(saved.wallet, { availablePoints: 0, heldPoints: 0 });
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
  assert.deepEqual(saved.wallet, { availablePoints: 0, heldPoints: 0 });
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
  assert.deepEqual(saved.wallet, { availablePoints: 3, heldPoints: 2 });
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
  assert.deepEqual(saved.wallet, { availablePoints: 3, heldPoints: 2 });
  assert.deepEqual(notified, [job.requestId]);
  await pool.end();
});
