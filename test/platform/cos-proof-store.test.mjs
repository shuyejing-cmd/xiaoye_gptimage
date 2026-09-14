import test from "node:test";
import assert from "node:assert/strict";
import { createCosProofStore } from "../../src/platform/payments/cos-proof-store.mjs";

test("payment proof uses an isolated private prefix and returns its digest", async () => {
  const calls = [];
  const cos = { putObject: (input, callback) => { calls.push(input); callback(null, {}); } };
  const store = createCosProofStore({ bucket: "bucket", region: "ap-shanghai", prefix: "private/payment-proofs", cos });
  const result = await store.put({ orderNo: "WB-100", buffer: Buffer.from("proof"), mimeType: "image/png" });
  assert.match(result.objectKey, /^private\/payment-proofs\/WB-100\/[a-f0-9]{64}\.png$/);
  assert.equal(result.sha256.length, 64);
  assert.equal(calls[0].ACL, "private");
});
