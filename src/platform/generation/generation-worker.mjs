const ambiguousSubmissionCodes = new Set(["provider_unreachable", "generation_submission_unknown"]);

export function createGenerationWorker({ jobs, provider, outputStore, inputStore, logger = console }) {
  async function removeReferences(keys) {
    if (!inputStore?.remove) return;
    await Promise.allSettled(keys.map((key) => inputStore.remove(key)));
  }

  return {
    async runNext() {
      const job = await jobs.claimNext();
      if (!job) return null;
      const referenceObjectKeys = job.payload.referenceObjectKeys || [];
      try {
        if (provider.mode !== "synchronous") {
          let submitted;
          try {
            submitted = await provider.submit({ ...job.payload.request, requestId: job.requestId });
          } catch (error) {
            if (!error?.retryable && error?.code !== "provider_protocol_error" && !ambiguousSubmissionCodes.has(error?.code)) throw error;
            await jobs.markUnknown({ requestId: job.requestId, errorCode: error?.code || "generation_submission_unknown" }).catch((markError) => logger.error?.({ event: "unknown_state_persist_failed", requestId: job.requestId, code: markError?.code || "database_error" }));
            return { requestId: job.requestId, state: "unknown" };
          }
          try {
            await jobs.markProviderPending({ requestId: job.requestId, upstreamTaskId: submitted.taskId });
          } catch (error) {
            await jobs.markUnknown({ requestId: job.requestId, errorCode: "generation_submission_unknown" }).catch((markError) => logger.error?.({ event: "unknown_state_persist_failed", requestId: job.requestId, code: markError?.code || "database_error" }));
            logger.error?.({ event: "provider_acceptance_persist_failed", requestId: job.requestId, code: error?.code || "database_error" });
            return { requestId: job.requestId, state: "unknown" };
          }
          return { requestId: job.requestId, state: "provider_pending" };
        }
        const referenceImages = referenceObjectKeys.length
          ? await Promise.all(referenceObjectKeys.map((key) => inputStore.getReference(key)))
          : undefined;
        const generated = await provider.generate({
          request: job.payload.request,
          referenceImages,
          requestId: job.requestId
        });
        let stored;
        try {
          stored = await outputStore.putGenerated({ buffer: generated.imageBuffer, mimeType: generated.mimeType, requestId: job.requestId });
        } catch (error) {
          await jobs.markUnknown({ requestId: job.requestId, errorCode: "output_persist_failed" });
          logger.error?.({ event: "output_persist_failed", requestId: job.requestId, code: error?.code || "storage_error" });
          return { requestId: job.requestId, state: "unknown" };
        }
        try {
          await jobs.markOutputPersisting({ requestId: job.requestId, objectKey: stored.objectKey, mimeType: stored.mimeType || generated.mimeType });
          await jobs.succeed({ requestId: job.requestId });
        } catch (error) {
          logger.error?.({ event: "output_settlement_deferred", requestId: job.requestId, code: error?.code || "database_error" });
          return { requestId: job.requestId, state: "output_persisting" };
        }
        await removeReferences(referenceObjectKeys);
        return { requestId: job.requestId, state: "succeeded" };
      } catch (error) {
        if (ambiguousSubmissionCodes.has(error?.code)) {
          await jobs.markUnknown({ requestId: job.requestId, errorCode: error.code });
          return { requestId: job.requestId, state: "unknown" };
        }
        await jobs.fail({ requestId: job.requestId, errorCode: error?.code || "generation_failed" });
        await removeReferences(referenceObjectKeys);
        return { requestId: job.requestId, state: "failed" };
      }
    }
  };
}
