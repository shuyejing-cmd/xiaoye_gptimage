import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { installWorkBuddyConfig, installVerifiedWorkBuddyConfig, removeWorkBuddyConfig, diagnoseWorkBuddyConfig, probeMcpEntry } from "../../installer/config-manager.mjs";
import { discoverWorkBuddyConfig, readRememberedConfigPath, rememberConfigPath } from "../../installer/config-discovery.mjs";

function createDiscoveryFixture(files = {}) {
  const normalized = new Map(Object.entries(files).map(([path, content]) => [path.replaceAll("\\", "/").toLowerCase(), content]));
  return {
    exists: async (path) => normalized.has(path.replaceAll("\\", "/").toLowerCase()),
    readText: async (path) => normalized.get(path.replaceAll("\\", "/").toLowerCase())
  };
}

test("configuration discovery honors explicit path before every automatic candidate", async () => {
  const probes = createDiscoveryFixture({
    "D:/chosen/mcp.json": "{}",
    "C:/Users/A/.workbuddy/mcp.json": JSON.stringify({ mcpServers: {} })
  });
  assert.deepEqual(await discoverWorkBuddyConfig({
    explicitPath: "D:/chosen/mcp.json",
    userProfile: "C:/Users/A",
    candidatePaths: ["E:/WorkBuddy/mcp.json"],
    ...probes
  }), { configPath: "D:/chosen/mcp.json", source: "explicit" });
});

test("configuration discovery prefers the existing documented user default", async () => {
  const probes = createDiscoveryFixture({
    "C:/Users/A/.workbuddy/mcp.json": JSON.stringify({ mcpServers: {} }),
    "E:/WorkBuddy/mcp.json": JSON.stringify({ mcpServers: { keep: {} } })
  });
  const result = await discoverWorkBuddyConfig({
    userProfile: "C:/Users/A",
    candidatePaths: ["E:/WorkBuddy/mcp.json"],
    ...probes
  });
  assert.equal(result.configPath.replaceAll("\\", "/"), "C:/Users/A/.workbuddy/mcp.json");
  assert.equal(result.source, "default");
});

test("configuration discovery accepts exactly one valid WorkBuddy candidate", async () => {
  const probes = createDiscoveryFixture({
    "D:/unrelated/mcp.json": JSON.stringify({ setting: true }),
    "E:/WorkBuddy/mcp.json": JSON.stringify({ mcpServers: { keep: {} } })
  });
  assert.deepEqual(await discoverWorkBuddyConfig({
    userProfile: "C:/Users/A",
    candidatePaths: ["D:/unrelated/mcp.json", "E:/WorkBuddy/mcp.json"],
    ...probes
  }), { configPath: "E:/WorkBuddy/mcp.json", source: "discovered" });
});

test("configuration discovery rejects ambiguous and missing candidates with stable codes", async () => {
  const ambiguous = createDiscoveryFixture({
    "D:/one/mcp.json": JSON.stringify({ mcpServers: {} }),
    "E:/two/mcp.json": JSON.stringify({ mcpServers: {} })
  });
  await assert.rejects(
    discoverWorkBuddyConfig({ userProfile: "C:/Users/A", candidatePaths: ["D:/one/mcp.json", "E:/two/mcp.json"], ...ambiguous }),
    (error) => error.code === "workbuddy_config_ambiguous"
  );
  await assert.rejects(
    discoverWorkBuddyConfig({ userProfile: "C:/Users/A", candidatePaths: ["D:/unrelated/mcp.json"], ...createDiscoveryFixture({ "D:/unrelated/mcp.json": "{}" }) }),
    (error) => error.code === "workbuddy_config_not_found"
  );
});

test("a discovered or explicit config path is remembered for doctor, repair, and uninstall", async () => {
  const installDir = await mkdtemp(join(tmpdir(), "wb-config-state-"));
  let restricted;
  await rememberConfigPath({ installDir, configPath: "D:/Custom/WorkBuddy/mcp.json", restrict: async (path) => { restricted = path; } });
  assert.ok(restricted);
  assert.equal(await readRememberedConfigPath(installDir), "D:/Custom/WorkBuddy/mcp.json");
});

test("installer merges only xiaoye-image, writes atomically, and keeps a backup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wb-installer-"));
  const configPath = join(directory, "mcp.json");
  const installDir = join(directory, "installed");
  await mkdir(join(installDir, "runtime"), { recursive: true });
  await mkdir(join(installDir, "app", "src"), { recursive: true });
  await writeFile(join(installDir, "runtime", "node.exe"), "runtime");
  await writeFile(join(installDir, "app", "src", "index.mjs"), "bridge");
  await writeFile(configPath, JSON.stringify({ mcpServers: { existing: { command: "keep.exe" } }, setting: true }));
  const result = await installWorkBuddyConfig({ configPath, gatewayUrl: "https://xiaoyeai.cn", apiKey: "wb_live_public_secret", allowedRoots: ["C:/Pictures"], installDir });
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(saved.mcpServers.existing, { command: "keep.exe" });
  assert.equal(saved.setting, true);
  assert.equal(saved.mcpServers["xiaoye-image"].env.IMAGE_API_KEY, "wb_live_public_secret");
  assert.equal(saved.mcpServers["xiaoye-image"].env.ALLOWED_IMAGE_ROOTS, "C:/Pictures");
  assert.ok(result.backupPath);
  assert.equal((await diagnoseWorkBuddyConfig({ configPath, gatewayUrl: "https://xiaoyeai.cn", apiKey: "wb_live_public_secret", fetchImpl: async () => new Response(JSON.stringify({ available_credits: 5, held_credits: 0 }), { status: 200 }), mcpProbe: async () => true })).ok, true);
});

test("uninstall removes only xiaoye-image and preserves every other MCP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wb-uninstall-"));
  const configPath = join(directory, "mcp.json");
  await writeFile(configPath, JSON.stringify({ mcpServers: { existing: { command: "keep.exe" }, "xiaoye-image": { command: "node.exe" } } }));
  await removeWorkBuddyConfig({ configPath });
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(Object.keys(saved.mcpServers), ["existing"]);
});

test("diagnosis verifies runtime command and bridge files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wb-diagnose-"));
  const configPath = join(directory, "mcp.json");
  const installDir = join(directory, "installed");
  await mkdir(join(installDir, "runtime"), { recursive: true });
  await mkdir(join(installDir, "app", "src"), { recursive: true });
  await writeFile(join(installDir, "runtime", "node.exe"), "runtime");
  await writeFile(join(installDir, "app", "src", "index.mjs"), "bridge");
  await installWorkBuddyConfig({ configPath, gatewayUrl: "https://xiaoyeai.cn", apiKey: "wb_live_public_secret", allowedRoots: [], installDir });
  const result = await diagnoseWorkBuddyConfig({
    configPath,
    gatewayUrl: "https://xiaoyeai.cn",
    apiKey: "wb_live_public_secret",
    fetchImpl: async () => new Response("{}", { status: 200 }),
    mcpProbe: async () => true
  });
  assert.deepEqual(result.checks, { json: true, entry: true, command: true, bridge: true, mcp: true, key: true, gateway: true });
  assert.equal(result.ok, true);
});

test("verified installation restores the previous config when post-write diagnosis fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wb-rollback-"));
  const configPath = join(directory, "mcp.json");
  const original = JSON.stringify({ mcpServers: { existing: { command: "keep.exe" } } });
  await writeFile(configPath, original);
  await assert.rejects(installVerifiedWorkBuddyConfig({
    configPath,
    gatewayUrl: "https://xiaoyeai.cn",
    apiKey: "wb_live_public_secret",
    allowedRoots: [],
    installDir: join(directory, "missing-install"),
    fetchImpl: async () => new Response("{}", { status: 200 }),
    mcpProbe: async () => false
  }), (error) => error.code === "workbuddy_config_self_check_failed");
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), JSON.parse(original));
});

test("installer rejects structurally invalid JSON without rewriting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wb-invalid-config-"));
  const configPath = join(directory, "mcp.json");
  const original = JSON.stringify({ mcpServers: [] });
  await writeFile(configPath, original);
  await assert.rejects(installWorkBuddyConfig({
    configPath,
    gatewayUrl: "https://xiaoyeai.cn",
    apiKey: "wb_live_public_secret",
    allowedRoots: [],
    installDir: directory
  }), (error) => error.code === "workbuddy_config_invalid");
  assert.equal(await readFile(configPath, "utf8"), original);
});

test("a failed temporary-file ACL step leaves no plaintext Key file behind", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wb-temp-cleanup-"));
  const configPath = join(directory, "mcp.json");
  const original = JSON.stringify({ mcpServers: { keep: { command: "keep.exe" } } });
  await writeFile(configPath, original);
  await assert.rejects(installVerifiedWorkBuddyConfig({
    configPath,
    gatewayUrl: "https://xiaoyeai.cn",
    apiKey: "wb_live_must_not_remain",
    allowedRoots: [],
    installDir: directory,
    restrict: async (path) => { if (path.includes(".tmp-")) throw new Error("acl failed"); },
    mcpProbe: async () => true,
    fetchImpl: async () => new Response("{}", { status: 200 })
  }), /acl failed/);
  assert.equal(await readFile(configPath, "utf8"), original);
  assert.deepEqual((await readdir(directory)).filter((name) => name.includes(".tmp-")), []);
});

test("local MCP probe performs a real stdio handshake and lists image tools", async () => {
  assert.equal(await probeMcpEntry({
    entry: {
      command: process.execPath,
      args: [resolve("src/index.mjs")],
      env: { IMAGE_GATEWAY_URL: "https://xiaoyeai.cn", IMAGE_API_KEY: "wb_live_probe", ALLOWED_IMAGE_ROOTS: "" }
    }
  }), true);
});
