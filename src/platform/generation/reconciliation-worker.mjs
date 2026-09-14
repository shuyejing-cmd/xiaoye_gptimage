const SUCCESS_STATES = new Set(["completed", "succeeded", "success"]);
const FAILURE_STATES = new Set(["failed", "rejected", "cancelled", "canceled"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export function createReconciliationWorker({ jobs, providers, outputStore, notifyManualReview = async () => {}, now = () => new Date(), logger = console }) {
  async function removeReferences(job) {
    if (!job.encryptedPayload || !outputStore?.remove) return;
    try {
      const payload = jobs.decrypt(job);
      await Promise.allSettled((payload.referenceObjectKeys || []).map((key) => outputStore.remove(key)));
    } catch (error) {
      logger.error?.({ event: "reference_cleanup_failed", requestId: job.requestId, code: error?.code || "payload_error" });
    }
  }

  async function reconcileOutput(job) {
    try {
      let output = job.outputObjectKey ? { objectKey: job.outputObjectKey, mimeType: job.outputMimeType } : null;
      if (!output && outputStore?.findGenerated) output = await outputStore.findGenerated(job.requestId);
      if (!output) {
        if (job.state === "submitting") await jobs.markUnknown({ requestId: job.requestId, errorCode: "generation_submission_unknown" });
        return;
      }
      if (!job.outputObjectKey) await jobs.markOutputPersisting({ requestId: job.requestId, objectKey: output.objectKey, mimeType: output.mimeType });
      if (!outputStore?.exists || await outputStore.exists(output.objectKey)) {
        await jobs.succeed({ requestId: job.requestId });
        await removeReferences(job);
      }
    } catch (error) {
      logger.error?.({ event: "output_reconciliation_failed", requestId: job.requestId, code: error?.code || "storage_error" });
    }
  }

  async function reconcileProvider(job) {
    if (!job.upstreamTaskId) return;
    const provider = providers[job.provider];
    if (!provider?.getTask) return;
    try {
      const task = await provider.getTask(job.upstreamTaskId);
      const state = String(task.status || "").toLowerCase();
      if (SUCCESS_STATES.has(state) && task.imageUrl) {
        const stored = await outputStore.putGeneratedFromUrl({ url: task.imageUrl, requestId: job.requestId });
        await jobs.markOutputPersisting({ requestId: job.requestId, objectKey: stored.objectKey, mimeType: stored.mimeType });
        await jobs.succeed({ requestId: job.requestId });
        await removeReferences(job);
      } else if (FAILURE_STATES.has(state)) {
        await jobs.fail({ requestId: job.requestId, errorCode: task.errorCode || "provider_generation_failed" });
        await removeReferences(job);
      }
    } catch (error) {
      logger.error?.({ event: "provider_reconciliation_failed", requestId: job.requestId, code: error?.code || "provider_unreachable" });
    }
  }

  return {
    async runOnce() {
      const candidates = await jobs.listReconciliationCandidates({ staleSubmittingBefore: new Date(now().getTime() - 10 * 60 * 1000) });
      for (const job of candidates) {
        if (job.state === "output_persisting" || job.state === "submitting" || (job.state === "unknown" && !job.upstreamTaskId)) await reconcileOutput(job);
        else await reconcileProvider(job);
      }
      const escalated = await jobs.escalateUnresolved({ olderThan: new Date(now().getTime() - DAY_MS) });
      if (outputStore?.remove) {
        for (const requestId of escalated) {
          const candidate = candidates.find((job) => job.requestId === requestId && job.encryptedPayload);
          if (!candidate) continue;
          const payload = jobs.decrypt(candidate);
          await Promise.allSettled((payload.referenceObjectKeys || []).map((key) => outputStore.remove(key)));
        }
      }
      if (escalated.length) await notifyManualReview(escalated);
      return { inspected: candidates.length, escalated };
    }
  };
}
