import { loadPlatformConfig } from "./config.mjs";
import { createPlatformRuntime } from "./runtime.mjs";
import { createGenerationWorker } from "./generation/generation-worker.mjs";
import { createReconciliationWorker } from "./generation/reconciliation-worker.mjs";

const config = loadPlatformConfig();
const runtime = await createPlatformRuntime(config);
const worker = createGenerationWorker({ jobs: runtime.generationJobs, provider: runtime.provider, outputStore: runtime.temporaryStore, inputStore: runtime.temporaryStore });
const reconciler = createReconciliationWorker({
  jobs: runtime.generationJobs,
  providers: { [config.imageProvider]: runtime.provider },
  outputStore: runtime.temporaryStore,
  notifyManualReview: (requestIds) => runtime.mailer.sendManualReview({ email: config.adminNotificationEmail, requestIds })
});
let stopping = false;
let busy = false;

async function tick() {
  if (busy || stopping) return;
  busy = true;
  try { await Promise.all(Array.from({ length: config.providerConcurrency }, () => worker.runNext())); }
  catch (error) { console.error(JSON.stringify({ event: "worker_tick_failed", code: error?.code || "internal_error" })); }
  finally { busy = false; }
}

const workerTimer = setInterval(tick, 250);
async function reconcileAndExpire() {
  await reconciler.runOnce();
  await runtime.paymentService.expireCreatedOrders();
  await runtime.rateLimiter.cleanup({ olderThan: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
}
const reconciliationTimer = setInterval(() => reconcileAndExpire().catch((error) => console.error(JSON.stringify({ event: "reconciliation_failed", code: error?.code || "internal_error" }))), 60_000);
await reconcileAndExpire();

async function stop() {
  stopping = true;
  clearInterval(workerTimer);
  clearInterval(reconciliationTimer);
  while (busy) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  await runtime.pool.end();
  process.exit(0);
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
