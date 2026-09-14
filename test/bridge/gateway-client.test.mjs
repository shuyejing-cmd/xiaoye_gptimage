import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayClient } from "../../src/bridge/gateway-client.mjs";

test("bridge sends text-only generations as JSON", async () => {
  let init;
  const client = createGatewayClient({ baseUrl: "https://xiaoyeai.cn", token: "token", idempotencyKeyFactory: () => "idem-fixed", fetchImpl: async (_url, request) => { init = request; return new Response(JSON.stringify({ status: "completed" }), { status: 200, headers: { "content-type": "application/json" } }); } });
  const result = await client.generateText({ prompt: "orange cat" });
  assert.deepEqual(result, { status: "completed" });
  assert.equal(init.headers["content-type"], "application/json");
  assert.equal(init.headers.Authorization, "Bearer token");
  assert.equal(init.headers["Idempotency-Key"], "idem-fixed");
  assert.equal(init.body, JSON.stringify({ prompt: "orange cat" }));
});

test("bridge exposes generation status and account balance endpoints", async () => {
  const urls = [];
  const client = createGatewayClient({ baseUrl: "https://xiaoyeai.cn", token: "token", fetchImpl: async (url) => { urls.push(url); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); } });
  await client.getGeneration("request-1");
  await client.getBalance();
  assert.deepEqual(urls, ["https://xiaoyeai.cn/v1/generations/request-1", "https://xiaoyeai.cn/v1/account/balance"]);
});
test("bridge appends all reference images as ordered multipart image fields", async () => {
  let init;
  const client = createGatewayClient({ baseUrl: "https://xiaoyeai.cn", token: "token", fetchImpl: async (_url, request) => { init = request; return new Response(JSON.stringify({ status: "completed" }), { status: 200, headers: { "content-type": "application/json" } }); } });
  await client.generateWithReferences({ prompt: "combine them" }, [
    { buffer: Buffer.from("one"), mimeType: "image/png", fileName: "one.png" },
    { buffer: Buffer.from("two"), mimeType: "image/jpeg", fileName: "two.jpg" },
  ]);
  assert.equal(init.body.get("request"), JSON.stringify({ prompt: "combine them" }));
  assert.deepEqual(init.body.getAll("image").map((file) => file.name), ["one.png", "two.jpg"]);
});

test("a transport retry reuses the exact same idempotency key", async () => {
  const seen = [];
  let attempts = 0;
  const client = createGatewayClient({
    baseUrl: "https://xiaoyeai.cn",
    token: "token",
    idempotencyKeyFactory: () => "stable-retry-key",
    fetchImpl: async (_url, request) => {
      seen.push(request.headers["Idempotency-Key"]);
      attempts += 1;
      if (attempts === 1) throw new TypeError("socket closed");
      return new Response(JSON.stringify({ request_id: "one" }), { status: 202, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal((await client.generateText({ prompt: "cat" })).request_id, "one");
  assert.deepEqual(seen, ["stable-retry-key", "stable-retry-key"]);
});

test("generate waits for an accepted job and returns the completed result within the polling window", async () => {
  const responses = [
    { request_id: "job-1", status: "queued" },
    { request_id: "job-1", status: "provider_pending" },
    { request_id: "job-1", status: "succeeded", image_url: "https://cos.example/job-1.png" }
  ];
  const client = createGatewayClient({
    baseUrl: "https://xiaoyeai.cn",
    token: "token",
    sleep: async () => {},
    fetchImpl: async () => new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } })
  });
  const result = await client.generateText({ prompt: "cat" });
  assert.equal(result.status, "succeeded");
  assert.equal(result.image_url, "https://cos.example/job-1.png");
});
