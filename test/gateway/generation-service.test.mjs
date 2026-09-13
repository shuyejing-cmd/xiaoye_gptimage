import assert from "node:assert/strict";
import test from "node:test";
import { createGenerationService } from "../../src/gateway/generation-service.mjs";

const request = { prompt: "orange cat", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 };

test("synchronous provider stores Base64-derived image in COS before returning", async () => {
  const calls = [];
  let providerInput;
  const service = createGenerationService({
    taskStore: {
      create: (value) => calls.push(["create", value]),
      markCompleted: (value) => calls.push(["completed", value]),
      markFailed: (value) => calls.push(["failed", value])
    },
    imageProvider: { mode: "synchronous", generate: async (input) => { providerInput = input; return { imageBuffer: Buffer.from("image-bytes"), mimeType: "image/png" }; } },
    outputStore: { putGenerated: async (input) => { calls.push(["put", input]); return { imageUrl: "https://cos.example/output.png", expiresAt: "tomorrow" }; } },
    now: () => 100,
    requestIdFactory: () => "req-1"
  });

  const result = await service.generate({ request });

  assert.deepEqual(result, { requestId: "req-1", status: "completed", imageUrl: "https://cos.example/output.png", expiresAt: "tomorrow" });
  assert.equal(providerInput.requestId, "req-1");
  assert.equal(calls[1][0], "put");
  assert.equal(calls[1][1].buffer.toString(), "image-bytes");
  assert.equal(calls[2][0], "completed");
});
test("asynchronous providers reject more than one reference image instead of dropping extras", async () => {
  const service = createGenerationService({
    taskStore: { create() {}, markCompleted() {}, markFailed() {} },
    referenceStore: { put: async () => assert.fail("reference images must not be uploaded") },
    imageProvider: { mode: "asynchronous", submit: async () => assert.fail("provider must not be called") },
    outputStore: {},
    requestIdFactory: () => "req-1"
  });

  await assert.rejects(
    () => service.generate({ request, referenceImages: [
      { buffer: Buffer.from("one"), mimeType: "image/png", fileName: "one.png" },
      { buffer: Buffer.from("two"), mimeType: "image/png", fileName: "two.png" }
    ] }),
    (error) => error.code === "multiple_reference_images_unsupported" && error.httpStatus === 400
  );
});