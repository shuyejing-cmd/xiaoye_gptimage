import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayClient } from "../../src/bridge/gateway-client.mjs";

test("bridge sends text-only generations as JSON", async () => {
  let init;
  const client = createGatewayClient({ baseUrl: "https://xiaoyeai.cn", token: "token", fetchImpl: async (_url, request) => { init = request; return new Response(JSON.stringify({ status: "completed" }), { status: 200, headers: { "content-type": "application/json" } }); } });
  const result = await client.generateText({ prompt: "orange cat" });
  assert.deepEqual(result, { status: "completed" });
  assert.equal(init.headers["content-type"], "application/json");
  assert.equal(init.headers.Authorization, "Bearer token");
  assert.equal(init.body, JSON.stringify({ prompt: "orange cat" }));
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