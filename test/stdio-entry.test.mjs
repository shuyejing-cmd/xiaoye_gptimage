import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("stdio entry starts and exposes generate_image", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/index.mjs"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-probe-test", version: "1.0.0" });

  t.after(async () => {
    await client.close();
  });

  await client.connect(transport);
  const tools = await client.listTools();

  assert.equal(tools.tools.some((tool) => tool.name === "generate_image"), true);
});
