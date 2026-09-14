import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installWorkBuddyConfig, removeWorkBuddyConfig, diagnoseWorkBuddyConfig } from "../../installer/config-manager.mjs";

test("installer merges only xiaoye-image, writes atomically, and keeps a backup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wb-installer-"));
  const configPath = join(directory, "mcp.json");
  await writeFile(configPath, JSON.stringify({ mcpServers: { existing: { command: "keep.exe" } }, setting: true }));
  const result = await installWorkBuddyConfig({ configPath, gatewayUrl: "https://xiaoyeai.cn", apiKey: "wb_live_public_secret", allowedRoots: ["C:/Pictures"], installDir: "C:/Program Files/WorkBuddy Image MCP" });
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(saved.mcpServers.existing, { command: "keep.exe" });
  assert.equal(saved.setting, true);
  assert.equal(saved.mcpServers["xiaoye-image"].env.IMAGE_API_KEY, "wb_live_public_secret");
  assert.equal(saved.mcpServers["xiaoye-image"].env.ALLOWED_IMAGE_ROOTS, "C:/Pictures");
  assert.ok(result.backupPath);
  assert.equal((await diagnoseWorkBuddyConfig({ configPath, gatewayUrl: "https://xiaoyeai.cn", apiKey: "wb_live_public_secret", fetchImpl: async () => new Response(JSON.stringify({ available_credits: 5, held_credits: 0 }), { status: 200 }) })).ok, true);
});

test("uninstall removes only xiaoye-image and preserves every other MCP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wb-uninstall-"));
  const configPath = join(directory, "mcp.json");
  await writeFile(configPath, JSON.stringify({ mcpServers: { existing: { command: "keep.exe" }, "xiaoye-image": { command: "node.exe" } } }));
  await removeWorkBuddyConfig({ configPath });
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(Object.keys(saved.mcpServers), ["existing"]);
});
