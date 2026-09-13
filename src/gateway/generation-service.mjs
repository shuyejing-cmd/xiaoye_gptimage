import { randomUUID } from "node:crypto";
import { AppError } from "../shared/errors.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeReferenceImages({ referenceImage, referenceImages }) {
  const images = referenceImages ?? (referenceImage ? [referenceImage] : []);
  if (!Array.isArray(images)) throw new AppError({ code: "invalid_reference_images", message: "reference images must be an array", httpStatus: 400 });
  if (images.length > 4) throw new AppError({ code: "too_many_reference_images", message: "at most four reference images are allowed", httpStatus: 400 });
  return images;
}

export function createGenerationService({ taskStore, referenceStore, apimartClient, imageProvider = apimartClient, outputStore, now = Date.now, requestIdFactory = randomUUID, pollIntervalMs = 2000, pollTimeoutMs = 90000 }) {
  return {
    async generate({ request, referenceImage, referenceImages }) {
      const requestId = requestIdFactory();
      const createdAt = now();
      taskStore.create({ requestId, createdAt });
      const images = normalizeReferenceImages({ referenceImage, referenceImages });
      let reference;
      try {
        if (imageProvider.mode === "synchronous") {
          const generated = await imageProvider.generate({ request, referenceImages: images.length ? images : undefined, requestId });
          const output = generated.imageUrl ? { imageUrl: generated.imageUrl, expiresAt: generated.expiresAt } : await outputStore.putGenerated({ buffer: generated.imageBuffer, mimeType: generated.mimeType, requestId });
          taskStore.markCompleted({ requestId, completedAt: now(), imageUrl: output.imageUrl });
          return { requestId, status: "completed", imageUrl: output.imageUrl, expiresAt: output.expiresAt };
        }

        if (images.length > 1) {
          throw new AppError({ code: "multiple_reference_images_unsupported", message: "the selected image provider does not support multiple reference images", httpStatus: 400 });
        }
        if (images[0]) reference = await referenceStore.put({ ...images[0], requestId });
        const { taskId } = await imageProvider.submit({ ...request, reference_image_url: reference?.publicUrl });
        taskStore.markSubmitted({ requestId, taskId });
        while (now() - createdAt < pollTimeoutMs) {
          const task = await imageProvider.getTask(taskId);
          if (task.status === "completed" && task.imageUrl) {
            taskStore.markCompleted({ requestId, completedAt: now(), imageUrl: task.imageUrl });
            return { requestId, status: "completed", imageUrl: task.imageUrl, expiresAt: task.expiresAt };
          }
          if (task.status === "failed") throw new AppError({ code: "generation_failed", message: "image generation failed", httpStatus: 502 });
          await sleep(pollIntervalMs);
        }
        throw new AppError({ code: "generation_timeout", message: "image generation timed out", httpStatus: 504 });
      } catch (error) {
        taskStore.markFailed({ requestId, completedAt: now(), errorCode: error.code || "generation_error" });
        throw error;
      } finally {
        if (reference) await referenceStore.remove(reference.key).catch(() => {});
      }
    }
  };
}