import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package declares Node 22.13+ and service scripts", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.engines.node, ">=22.13.0");
  assert.equal(pkg.scripts.bridge, "node src/index.mjs");
  assert.equal(pkg.scripts.gateway, "node src/gateway/index.mjs");
});
