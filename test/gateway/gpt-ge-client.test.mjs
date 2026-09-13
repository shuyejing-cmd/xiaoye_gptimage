import assert from "node:assert/strict";
import test from "node:test";
import { createGptGeClient } from "../../src/gateway/gpt-ge-client.mjs";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8VwAAAABJRU5ErkJggg==", "base64");

test("gpt.ge text generation decodes and verifies its Base64 image response", async () => {
  let request;
  const client = createGptGeClient({
    apiKey: "key",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG.toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await client.generate({ request: { prompt: "orange cat", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 } });

  assert.equal(request.url, "https://api.gpt.ge/v1/images/generations");
  assert.equal(request.init.headers.Authorization, "Bearer key");
  assert.deepEqual(JSON.parse(request.init.body), { model: "gpt-image-2", prompt: "orange cat", n: 1, size: "832x832", quality: "medium", output_format: "png" });
  assert.deepEqual(result.imageBuffer, ONE_PIXEL_PNG);
  assert.equal(result.mimeType, "image/png");
});

test("gpt.ge reference generation downloads its URL result into verified image bytes", async () => {
  let fetches = 0;
  const client = createGptGeClient({
    apiKey: "key",
    fetchImpl: async () => {
      fetches += 1;
      if (fetches === 1) return new Response(JSON.stringify({ data: [{ url: "https://provider.example/edited.png" }] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(ONE_PIXEL_PNG, { status: 200, headers: { "content-type": "image/png" } });
    },
    dnsLookup: async () => [{ address: "203.1.2.3", family: 4 }],
  });

  const result = await client.generate({ request: { prompt: "make it blue", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 }, referenceImage: { buffer: Buffer.from("input-image"), mimeType: "image/png", fileName: "input.png" } });

  assert.equal(fetches, 2);
  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(result.imageBuffer, ONE_PIXEL_PNG);
});

test("gpt.ge rejects a reference image larger than 4 MiB before calling the provider", async () => {
  const client = createGptGeClient({
    apiKey: "key",
    fetchImpl: async () => assert.fail("the provider must not be called")
  });

  await assert.rejects(
    () => client.generate({
      request: { prompt: "make it blue", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 },
      referenceImage: { buffer: Buffer.alloc(4 * 1024 * 1024 + 1), mimeType: "image/png", fileName: "input.png" }
    }),
    (error) => error.code === "reference_image_too_large" && error.httpStatus === 400
  );
});
test("gpt.ge logs only response shape and request ID for an unrecognized 200 response", async () => {
  const events = [];
  const client = createGptGeClient({
    apiKey: "key",
    logger: { error: (event) => events.push(event) },
    fetchImpl: async () => new Response(JSON.stringify({ created: 1, data: [{ message: "not an image", code: "upstream_shape_changed" }] }), { status: 200 }),
  });

  await assert.rejects(
    () => client.generate({ requestId: "req-diagnostic", request: { prompt: "orange cat", size: "1:1", resolution: "1k", quality: "medium", output_format: "png", n: 1 } }),
    (error) => error.code === "provider_protocol_error",
  );
  assert.deepEqual(events, [{
    event: "provider_protocol_error",
    requestId: "req-diagnostic",
    httpStatus: 200,
    topLevelKeys: ["created", "data"],
    dataItemKeys: ["message", "code"],
  }]);
});
test("gpt.ge appends up to four reference images to its edits request", async () => {
  const requests = [];
  const client = createGptGeClient({
    apiKey: "key",
    fetchImpl: async (_url, init) => {
      requests.push(init);
      if (requests.length === 1) return new Response(JSON.stringify({ data: [{ url: "https://provider.example/edited.png" }] }), { status: 200 });
      return new Response(ONE_PIXEL_PNG, { status: 200 });
    },
    dnsLookup: async () => [{ address: "203.1.2.3", family: 4 }],
  });
  await client.generate({ request: { prompt: "combine", size: "1:1", quality: "medium", output_format: "png" }, referenceImages: [
    { buffer: Buffer.from("one"), mimeType: "image/png", fileName: "one.png" },
    { buffer: Buffer.from("two"), mimeType: "image/png", fileName: "two.png" },
  ] });
  assert.deepEqual(requests[0].body.getAll("image").map((file) => file.name), ["one.png", "two.png"]);
});
test("gpt.ge maps a content-policy rejection to a safe WorkBuddy error and logs only diagnostics", async () => {
  const events = [];
  const client = createGptGeClient({
    apiKey: "key",
    logger: { error: (event) => events.push(event) },
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: "copyright_violation", type: "content_policy", message: "copyrighted character" } }), { status: 400 })
  });
  await assert.rejects(
    () => client.generate({ request: { prompt: "copyrighted character", size: "1:1", quality: "medium", output_format: "png" } }),
    (error) => error.code === "content_policy_violation" && error.message === "\u6b64\u6b21\u751f\u6210\u56e0\u7248\u6743\u6216\u5185\u5bb9\u5b89\u5168\u9650\u5236\u88ab\u62d2\u7edd\uff0c\u8bf7\u4fee\u6539\u63d0\u793a\u8bcd\u6216\u66f4\u6362\u53c2\u8003\u56fe\u540e\u91cd\u8bd5\u3002"
  );
  assert.deepEqual(events, [{ event: "provider_request_failed", provider: "gpt_ge", upstreamStatus: 400, category: "content_policy_violation", upstreamCode: "copyright_violation", upstreamType: "content_policy" }]);
});