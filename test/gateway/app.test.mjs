import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/gateway/app.mjs";

const token = "test-token";
const completed = { requestId: "req-1", status: "completed", imageUrl: "https://example.test/image.png", expiresAt: "2026-01-01T00:00:00Z" };

test("gateway accepts an authenticated JSON generation request", async () => {
  const calls = [];
  const app = createApp({ gatewayToken: token, generationService: { generate: async (input) => { calls.push(input); return completed; } } });
  const response = await app.inject({ method: "POST", url: "/v1/bridge/generations", headers: { authorization: `Bearer ${token}` }, payload: { prompt: "orange cat" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { request_id: completed.requestId, status: "completed", image_url: completed.imageUrl, expires_at: completed.expiresAt });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { request: { prompt: "orange cat", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 }, referenceImages: undefined });
  await app.close();
});

test("gateway rejects an unauthenticated generation request", async () => {
  const app = createApp({ gatewayToken: token, generationService: { generate: async () => completed } });
  const response = await app.inject({ method: "POST", url: "/v1/bridge/generations", payload: { prompt: "orange cat" } });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "unauthorized");
  await app.close();
});
function multipartPayload(boundary, parts) {
  return Buffer.concat(parts.flatMap((part) => [
    Buffer.from(`--${boundary}\r\n${part.headers}\r\n\r\n`),
    Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body),
    Buffer.from("\r\n"),
  ]).concat(Buffer.from(`--${boundary}--\r\n`)));
}

test("gateway accepts up to four multipart reference images in order", async () => {
  const calls = [];
  const app = createApp({ gatewayToken: token, generationService: { generate: async (input) => { calls.push(input); return completed; } } });
  const boundary = "test-boundary";
  const response = await app.inject({
    method: "POST",
    url: "/v1/bridge/generations",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: multipartPayload(boundary, [
      { headers: 'Content-Disposition: form-data; name="request"', body: JSON.stringify({ prompt: "combine" }) },
      { headers: 'Content-Disposition: form-data; name="image"; filename="one.png"\r\nContent-Type: image/png', body: Buffer.from("one") },
      { headers: 'Content-Disposition: form-data; name="image"; filename="two.jpg"\r\nContent-Type: image/jpeg', body: Buffer.from("two") },
    ]),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0].referenceImages.map((image) => image.fileName), ["one.png", "two.jpg"]);
  await app.close();
});
test("gateway rejects a fifth multipart reference image", async () => {
  const app = createApp({ gatewayToken: token, generationService: { generate: async () => assert.fail("generation must not be called") } });
  const boundary = "too-many-boundary";
  const imagePart = (name) => ({
    headers: `Content-Disposition: form-data; name="image"; filename="${name}.png"\r\nContent-Type: image/png`,
    body: Buffer.from("image")
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/bridge/generations",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: multipartPayload(boundary, [
      { headers: 'Content-Disposition: form-data; name="request"', body: JSON.stringify({ prompt: "combine" }) },
      imagePart("one"), imagePart("two"), imagePart("three"), imagePart("four"), imagePart("five")
    ])
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "too_many_reference_images");
  await app.close();
});
test("gateway rejects a reference image larger than 4 MiB", async () => {
  const app = createApp({ gatewayToken: token, generationService: { generate: async () => assert.fail("generation must not be called") } });
  const boundary = "too-large-boundary";
  const response = await app.inject({
    method: "POST",
    url: "/v1/bridge/generations",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: multipartPayload(boundary, [
      { headers: 'Content-Disposition: form-data; name="request"', body: JSON.stringify({ prompt: "combine" }) },
      { headers: 'Content-Disposition: form-data; name="image"; filename="large.png"\r\nContent-Type: image/png', body: Buffer.alloc(4 * 1024 * 1024 + 1) }
    ])
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "reference_image_too_large");
  await app.close();
});