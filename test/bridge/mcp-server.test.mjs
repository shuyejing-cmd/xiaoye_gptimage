import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBridgeServer } from "../../src/bridge/mcp-server.mjs";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8VwAAAABJRU5ErkJggg==", "base64");

test("createBridgeServer exposes generate_image", () => {
  const server = createBridgeServer({ allowedRoots: [], gatewayClient: {} });
  assert.ok(server);
});

test("bridge exposes generation lookup and balance tools", async () => {
  const server = createBridgeServer({ allowedRoots: [], gatewayClient: { getGeneration: async (requestId) => ({ request_id: requestId, status: "processing" }), getBalance: async () => ({ available_credits: 5, held_credits: 1 }) } });
  const client = new Client({ name: "bridge-tools", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ["generate_image", "get_balance", "get_generation"]);
  const generation = await client.callTool({ name: "get_generation", arguments: { request_id: "request-1" } });
  const balance = await client.callTool({ name: "get_balance", arguments: {} });
  assert.equal(JSON.parse(generation.content[0].text).status, "processing");
  assert.equal(JSON.parse(balance.content[0].text).available_credits, 5);
  await client.close();
  await server.close();
});

test("bridge supports the legacy single path and ordered multi-path calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-mcp-"));
  const one = join(root, "one.png");
  const two = join(root, "two.png");
  await Promise.all([writeFile(one, ONE_PIXEL_PNG), writeFile(two, ONE_PIXEL_PNG)]);
  const calls = [];
  const server = createBridgeServer({
    allowedRoots: [root],
    gatewayClient: {
      generateWithReferences: async (request, images) => {
        calls.push({ request, images });
        return { request_id: "req-1", status: "completed", image_url: "https://example.test/image.png" };
      },
      generateText: async () => assert.fail("text generation must not be called")
    }
  });
  const client = new Client({ name: "bridge-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const legacy = await client.callTool({ name: "generate_image", arguments: { prompt: "legacy", reference_image_path: one } });
  assert.equal(legacy.isError, undefined);
  const multiple = await client.callTool({ name: "generate_image", arguments: { prompt: "combine", reference_image_paths: [one, two] } });
  assert.equal(multiple.isError, undefined);
  assert.deepEqual(calls.map(({ images }) => images.map((image) => image.fileName)), [["one.png"], ["one.png", "two.png"]]);

  await client.close();
  await server.close();
});
import { createGatewayClient } from "../../src/bridge/gateway-client.mjs";

for (const sample of [
  { code: "content_policy_violation", message: "\u6b64\u6b21\u751f\u6210\u56e0\u7248\u6743\u6216\u5185\u5bb9\u5b89\u5168\u9650\u5236\u88ab\u62d2\u7edd\uff0c\u8bf7\u4fee\u6539\u63d0\u793a\u8bcd\u6216\u66f4\u6362\u53c2\u8003\u56fe\u540e\u91cd\u8bd5\u3002" },
  { code: "provider_insufficient_credits", message: "\u56fe\u50cf\u670d\u52a1\u4f59\u989d\u6216\u989d\u5ea6\u4e0d\u8db3\uff0c\u8bf7\u8054\u7cfb\u670d\u52a1\u7ba1\u7406\u5458\u68c0\u67e5\u8d26\u6237\u4f59\u989d\u6216\u5145\u503c\u3002" }
]) {
  test(`bridge exposes the ${sample.code} message to an MCP caller`, async () => {
    const gatewayClient = createGatewayClient({
      baseUrl: "https://xiaoyeai.cn",
      token: "token",
      fetchImpl: async () => new Response(JSON.stringify({ error: sample }), { status: 400, headers: { "content-type": "application/json" } })
    });
    const server = createBridgeServer({ allowedRoots: [], gatewayClient });
    const client = new Client({ name: "bridge-error-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "generate_image", arguments: { prompt: "cat" } });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, sample.message);
    await client.close();
    await server.close();
  });
}
