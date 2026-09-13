import assert from "node:assert/strict";
import test from "node:test";
import { createReferenceStore } from "../../src/gateway/cos-reference-store.mjs";

test("stores synchronous provider output privately and returns a signed URL", async () => {
  const calls = [];
  const cos = {
    putObject: (input, callback) => { calls.push(["put", input]); callback(null, {}); },
    getObjectUrl: (input, callback) => { calls.push(["signed", input]); callback(null, { Url: "https://cos.example/signed-output.png" }); },
    deleteObject: (_input, callback) => callback(null, {})
  };
  const store = createReferenceStore({ secretId: "id", secretKey: "secret", bucket: "bucket", region: "ap-shanghai", prefix: "workbuddy-reference-images", cos });

  const result = await store.putGenerated({ requestId: "req-1", buffer: Buffer.from("image"), mimeType: "image/png" });

  assert.equal(calls[0][0], "put");
  assert.equal(calls[0][1].Key, "workbuddy-reference-images/generated/req-1.png");
  assert.equal(calls[1][1].Expires, 86400);
  assert.equal(result.imageUrl, "https://cos.example/signed-output.png");
});