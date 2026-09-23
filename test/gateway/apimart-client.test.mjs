import assert from "node:assert/strict";
import test from "node:test";
import { createApimartClient } from "../../src/gateway/apimart-client.mjs";

test("defaults to the domestic APIMart API", async () => {
  let url;
  const client = createApimartClient({
    apiKey: "key",
    fetchImpl: async (requestUrl) => { url = requestUrl; return new Response(JSON.stringify({ data: [{ task_id: "task-1" }] }), { status: 200 }); }
  });
  await client.submit({ prompt: "cat", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 });
  assert.equal(url, "https://api.apib.ai/v1/images/generations");
});

test("reports an unreachable provider without leaking transport errors", async () => {
  const client = createApimartClient({ apiKey: "key", logger: { error() {} }, fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(
    () => client.submit({ prompt: "cat", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 }),
    (error) => error.code === "provider_unreachable" && error.httpStatus === 502
  );
});

test("uses a configured provider base URL", async () => {
  let url;
  const client = createApimartClient({ baseUrl: "https://api-backup.example/v1", apiKey: "key", fetchImpl: async (requestUrl) => { url = requestUrl; return new Response(JSON.stringify({ data: [{ task_id: "task-1" }] }), { status: 200, headers: { "content-type": "application/json" } }); } });
  await client.submit({ prompt: "cat", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 });
  assert.equal(url, "https://api-backup.example/v1/images/generations");
});
test("apimart maps an insufficient-credit rejection to a safe WorkBuddy error and logs only diagnostics", async () => {
  const events = [];
  const client = createApimartClient({
    apiKey: "key",
    logger: { error: (event) => events.push(event) },
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: "insufficient_credits", type: "billing", message: "account balance is empty" } }), { status: 402 })
  });
  await assert.rejects(
    () => client.submit({ prompt: "cat", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 }),
    (error) => error.code === "provider_insufficient_credits" && error.message === "\u56fe\u50cf\u670d\u52a1\u4f59\u989d\u6216\u989d\u5ea6\u4e0d\u8db3\uff0c\u8bf7\u8054\u7cfb\u670d\u52a1\u7ba1\u7406\u5458\u68c0\u67e5\u8d26\u6237\u4f59\u989d\u6216\u5145\u503c\u3002"
  );
  assert.deepEqual(events, [{ event: "provider_request_failed", provider: "apimart", upstreamStatus: 402, category: "provider_insufficient_credits", upstreamCode: "insufficient_credits", upstreamType: "billing" }]);
});
test("apimart preserves its provider-protocol error for a malformed success response", async () => {
  const client = createApimartClient({ apiKey: "key", logger: { error() {} }, fetchImpl: async () => new Response(JSON.stringify({ data: [{}] }), { status: 200 }) });
  await assert.rejects(
    () => client.submit({ prompt: "cat", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 }),
    (error) => error.code === "provider_protocol_error" && error.httpStatus === 502
  );
});

test("APIMart sends only documented 2.5 fields and uses operation-specific timeouts", async () => {
  const calls = [];
  const timeouts = [];
  const client = createApimartClient({
    apiKey: "key",
    model: "gpt-image-2.5-sunburst",
    signalFactory: (milliseconds) => { timeouts.push(milliseconds); return AbortSignal.abort(); },
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: init.body && JSON.parse(init.body) });
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (url.includes("/tasks/")) return new Response(JSON.stringify({ data: { status: "pending" } }), { status: 200 });
      return new Response(JSON.stringify({ data: [{ task_id: "task-25" }] }), { status: 200 });
    }
  });
  await client.healthCheck();
  await client.submit({
    prompt: "cat", size: "1:1", resolution: "4k", quality: "high", output_format: "png", n: 1,
    referenceImageUrls: ["https://cos.example/ref.png"], requestId: "must-not-leak", userId: 99
  });
  await client.getTask("task-25");
  assert.deepEqual(timeouts, [10_000, 30_000, 15_000]);
  assert.deepEqual(calls[1].body, {
    model: "gpt-image-2.5-sunburst",
    prompt: "cat",
    size: "1:1",
    resolution: "4k",
    quality: "high",
    output_format: "png",
    n: 1,
    image_urls: ["https://cos.example/ref.png"]
  });
});

test("APIMart downloads results through its injected transport with a 120 second budget", async () => {
  const calls = [];
  const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
  const client = createApimartClient({
    apiKey: "key",
    fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return new Response(png, { status: 200 }); }
  });
  const image = await client.downloadImage("https://upload.apimart.ai/result.png");
  assert.equal(image.mimeType, "image/png");
  assert.equal(calls[0].init.signal.constructor.name, "AbortSignal");
});
