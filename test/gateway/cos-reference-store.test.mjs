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
  assert.equal(calls[0][1].ACL, "private");
  assert.equal(calls[1][1].Expires, 86400);
  assert.equal(result.imageUrl, "https://cos.example/signed-output.png");
  assert.equal(result.objectKey, "workbuddy-reference-images/generated/req-1.png");
  assert.equal(result.mimeType, "image/png");
});

test("checks deterministic output existence and can read a private reference", async () => {
  const cos = {
    headObject: (input, callback) => callback(input.Key.endsWith("present.png") ? null : Object.assign(new Error("not found"), { statusCode: 404 }), {}),
    getObject: (_input, callback) => callback(null, { Body: Buffer.from("reference"), headers: { "content-type": "image/png" } }),
    putObject: (_input, callback) => callback(null, {}),
    getObjectUrl: (_input, callback) => callback(null, { Url: "https://cos.example/signed" }),
    deleteObject: (_input, callback) => callback(null, {})
  };
  const store = createReferenceStore({ secretId: "id", secretKey: "secret", bucket: "bucket", region: "ap-shanghai", cos });
  assert.equal(await store.exists("present.png"), true);
  assert.equal(await store.exists("missing.png"), false);
  assert.deepEqual(await store.findGenerated("present"), { objectKey: "workbuddy-reference-images/generated/present.png", mimeType: "image/png" });
  assert.equal(await store.findGenerated("missing"), null);
  assert.deepEqual(await store.getReference("reference.png"), { buffer: Buffer.from("reference"), mimeType: "image/png", fileName: "reference.png" });
});
