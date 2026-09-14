import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createPayloadCipher } from "../../src/platform/security/payload-cipher.mjs";
import { createGenerationJobs } from "../../src/platform/generation/generation-jobs.mjs";
import { createGenerationWorker } from "../../src/platform/generation/generation-worker.mjs";
import { AppError } from "../../src/shared/errors.mjs";

async function setup(provider, options = {}) {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const user = (await pool.query("insert into users(email,status,role) values('worker@example.com','active','user') returning id")).rows[0];
  await pool.query("insert into wallets(user_id,available_credits,held_credits) values($1,5,0)", [user.id]);
  let id = 0;
  const cipher = createPayloadCipher({ key: Buffer.alloc(32, 9) });
  const jobs = createGenerationJobs({ pool, cipher, requestIdFactory: () => `worker-${++id}`, now: () => new Date("2026-09-13T00:00:00Z") });
  const stored = [];
  const outputStore = { putGenerated: async (value) => { stored.push(value); return { objectKey: `generated/${value.requestId}.png`, mimeType: value.mimeType }; } };
  const worker = createGenerationWorker({ jobs, provider, outputStore, inputStore: options.inputStore });
  return { pool, userId: user.id, jobs, worker, stored };
}

test("worker captures one credit only after persisting a verified provider result", async () => {
  const provider = { mode: "synchronous", generate: async () => ({ imageBuffer: Buffer.from("image"), mimeType: "image/png" }) };
  const { pool, userId, jobs, worker, stored } = await setup(provider);
  const job = await jobs.enqueue({ userId, idempotencyKey: "success", provider: "gpt_ge", request: { prompt: "cat" } });
  await worker.runNext();
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "succeeded");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 0 });
  assert.equal(stored.length, 1);
  await pool.end();
});

test("worker reads all private reference objects and removes them after success", async () => {
  const seen = [];
  const removed = [];
  const provider = { mode: "synchronous", generate: async ({ referenceImages }) => { seen.push(referenceImages); return { imageBuffer: Buffer.from("image"), mimeType: "image/png" }; } };
  const inputStore = {
    getReference: async (key) => ({ buffer: Buffer.from(key), mimeType: "image/png", fileName: `${key}.png` }),
    remove: async (key) => removed.push(key)
  };
  const { pool, userId, jobs, worker } = await setup(provider, { inputStore });
  await jobs.enqueue({ userId, idempotencyKey: "references", provider: "gpt_ge", request: { prompt: "cat" }, referenceObjectKeys: ["ref-a", "ref-b"] });
  await worker.runNext();
  assert.equal(seen[0].length, 2);
  assert.deepEqual(removed, ["ref-a", "ref-b"]);
  await pool.end();
});

test("explicit provider rejection releases the credit", async () => {
  const provider = { mode: "synchronous", generate: async () => { throw new AppError({ code: "content_policy_violation", message: "blocked", httpStatus: 400 }); } };
  const { pool, userId, jobs, worker } = await setup(provider);
  const job = await jobs.enqueue({ userId, idempotencyKey: "failed", provider: "gpt_ge", request: { prompt: "blocked" } });
  await worker.runNext();
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "failed");
  assert.deepEqual(saved.wallet, { availableCredits: 5, heldCredits: 0 });
  await pool.end();
});

test("ambiguous submission failure keeps the credit frozen without retrying", async () => {
  let calls = 0;
  const provider = { mode: "synchronous", generate: async () => { calls += 1; throw new AppError({ code: "provider_unreachable", message: "unknown", httpStatus: 502, retryable: true }); } };
  const { pool, userId, jobs, worker } = await setup(provider);
  const job = await jobs.enqueue({ userId, idempotencyKey: "unknown", provider: "gpt_ge", request: { prompt: "cat" } });
  await worker.runNext();
  await worker.runNext();
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "unknown");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 1 });
  assert.equal(calls, 1);
  await pool.end();
});

test("a database failure after output upload does not release the held credit", async () => {
  const provider = { mode: "synchronous", generate: async () => ({ imageBuffer: Buffer.from("image"), mimeType: "image/png" }) };
  const { pool, userId, jobs, stored } = await setup(provider);
  const worker = createGenerationWorker({
    jobs: {
      ...jobs,
      markOutputPersisting: async () => { throw new Error("database unavailable after upload"); }
    },
    provider,
    outputStore: { putGenerated: async (value) => { stored.push(value); return { objectKey: `generated/${value.requestId}.png`, mimeType: value.mimeType }; } },
    logger: { error() {} }
  });
  const job = await jobs.enqueue({ userId, idempotencyKey: "uploaded-before-db", provider: "gpt_ge", request: { prompt: "cat" } });
  const result = await worker.runNext();
  assert.equal(result.state, "output_persisting");
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "submitting");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 1 });
  assert.equal(stored.length, 1);
  await pool.end();
});

test("a database failure after provider acceptance keeps the charge held", async () => {
  const provider = { mode: "asynchronous", submit: async () => ({ taskId: "accepted-upstream-1" }) };
  const { pool, userId, jobs } = await setup(provider);
  const worker = createGenerationWorker({
    jobs: {
      ...jobs,
      markProviderPending: async () => { throw new Error("database unavailable after provider accepted"); }
    },
    provider,
    outputStore: {},
    logger: { error() {} }
  });
  const job = await jobs.enqueue({ userId, idempotencyKey: "accepted-before-db", provider: "apimart", request: { prompt: "cat" } });
  const result = await worker.runNext();
  assert.equal(result.state, "unknown");
  const saved = await jobs.getForUser({ userId, requestId: job.requestId });
  assert.equal(saved.state, "unknown");
  assert.deepEqual(saved.wallet, { availableCredits: 4, heldCredits: 1 });
  await pool.end();
});
