import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createProbeServer } from "../src/mcp-server.mjs";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8VwAAAABJRU5ErkJggg==",
  "base64",
);

test("probe_local_image is discoverable and returns image metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-image-probe-"));
  const imagePath = join(directory, "reference.png");
  await writeFile(imagePath, ONE_PIXEL_PNG);

  const server = createProbeServer();
  const client = new Client({ name: "probe-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  assert.equal(tools.tools.some((tool) => tool.name === "probe_local_image"), true);

  const result = await client.callTool({
    name: "probe_local_image",
    arguments: { image_path: imagePath },
  });

  assert.equal(result.isError, undefined);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.mimeType, "image/png");
  assert.equal(payload.bytes, ONE_PIXEL_PNG.length);
  assert.match(payload.sha256, /^[a-f0-9]{64}$/);

  await client.close();
  await server.close();
});
