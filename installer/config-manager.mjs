import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

function invalidConfig() {
  const error = new Error("workbuddy_config_invalid");
  error.code = "workbuddy_config_invalid";
  return error;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isLegacyImageBridge(entry) {
  if (!isObject(entry) || !isObject(entry.env) || !Array.isArray(entry.args)) return false;
  let gateway;
  try { gateway = new URL(entry.env.IMAGE_GATEWAY_URL); } catch { return false; }
  const bridgePath = String(entry.args[0] || "").replaceAll("\\", "/").toLowerCase();
  return gateway.origin === "https://xiaoyeai.cn"
    && gateway.pathname.replace(/\/+$/, "") === ""
    && Boolean(String(entry.env.IMAGE_GATEWAY_TOKEN || "").trim())
    && bridgePath.endsWith("/src/index.mjs");
}

async function readConfig(configPath, repair = false) {
  try {
    const value = JSON.parse(await readFile(configPath, "utf8"));
    if (!isObject(value) || (value.mcpServers !== undefined && !isObject(value.mcpServers))) {
      if (repair) return {};
      throw invalidConfig();
    }
    return value;
  }
  catch (error) {
    if (error.code === "ENOENT") return {};
    if (repair && error instanceof SyntaxError) return {};
    if (error.code === "workbuddy_config_invalid") throw error;
    if (error instanceof SyntaxError) throw invalidConfig();
    throw new Error("WorkBuddy mcp.json 已损坏；请先使用修复配置功能");
  }
}

async function atomicSave(configPath, value, now = () => Date.now(), restrictTemporary = async () => {}) {
  await mkdir(dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.tmp-${process.pid}-${now()}`;
  const backupPath = `${configPath}.backup-${now()}`;
  let hadExisting = false;
  let backupCreated = false;
  let installed = false;
  try {
    await writeFile(temporaryPath, "", { mode: 0o600 });
    await restrictTemporary(temporaryPath);
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    try { await access(configPath); hadExisting = true; } catch { /* new config */ }
    if (hadExisting) { await rename(configPath, backupPath); backupCreated = true; }
    await rename(temporaryPath, configPath);
    installed = true;
    return hadExisting ? backupPath : null;
  } catch (error) {
    if (backupCreated) {
      await unlink(configPath).catch(() => {});
      await rename(backupPath, configPath);
    }
    throw error;
  } finally {
    if (!installed) await unlink(temporaryPath).catch(() => {});
  }
}

export async function installWorkBuddyConfig({ configPath, gatewayUrl, apiKey, allowedRoots, installDir, repair = false, migrateLegacy = true, now, restrictTemporary }) {
  const current = await readConfig(configPath, repair);
  const next = { ...current, mcpServers: { ...(current.mcpServers || {}) } };
  if (migrateLegacy && isLegacyImageBridge(next.mcpServers["image-bridge"])) delete next.mcpServers["image-bridge"];
  next.mcpServers["xiaoye-image"] = {
    command: join(installDir, "runtime", "node.exe").replaceAll("\\", "/"),
    args: [join(installDir, "app", "src", "index.mjs").replaceAll("\\", "/")],
    env: {
      IMAGE_GATEWAY_URL: String(gatewayUrl).replace(/\/+$/, ""),
      IMAGE_API_KEY: apiKey,
      ALLOWED_IMAGE_ROOTS: allowedRoots.join(";")
    }
  };
  JSON.parse(JSON.stringify(next));
  return { config: next, backupPath: await atomicSave(configPath, next, now, restrictTemporary) };
}

export async function removeWorkBuddyConfig({ configPath, now }) {
  const current = await readConfig(configPath);
  const next = { ...current, mcpServers: { ...(current.mcpServers || {}) } };
  delete next.mcpServers["xiaoye-image"];
  return { config: next, backupPath: await atomicSave(configPath, next, now) };
}

export async function restoreWorkBuddyConfig({ configPath, backupPath }) {
  await unlink(configPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (backupPath) await rename(backupPath, configPath);
}

export async function probeMcpEntry({ entry, spawnImpl = spawn, timeoutMs = 8_000 }) {
  if (!entry?.command || !entry?.args?.[0]) return false;
  return new Promise((resolveProbe) => {
    let settled = false;
    let buffer = "";
    const child = spawnImpl(entry.command, entry.args, {
      env: { ...process.env, ...(entry.env || {}) },
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true
    });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolveProbe(value);
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("error", () => finish(false));
    child.once("exit", () => finish(false));
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1 && message.result) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (message.id === 2 && Array.isArray(message.result?.tools)) {
          const names = new Set(message.result.tools.map((tool) => tool.name));
          finish(names.has("generate_image") && names.has("get_generation") && names.has("get_balance"));
        }
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "workbuddy-installer-doctor", version: "1.2.2" } }
    });
  });
}

export async function diagnoseWorkBuddyConfig({ configPath, gatewayUrl, apiKey, fetchImpl = fetch, exists = async (path) => { try { await access(path); return true; } catch { return false; } }, mcpProbe = probeMcpEntry }) {
  const checks = { json: false, entry: false, command: false, bridge: false, mcp: false, key: false, gateway: false };
  try {
    const config = await readConfig(configPath);
    checks.json = true;
    const entry = config.mcpServers?.["xiaoye-image"];
    checks.entry = Boolean(entry);
    checks.command = Boolean(entry?.command && await exists(entry.command));
    checks.bridge = Boolean(entry?.args?.[0] && await exists(entry.args[0]));
    checks.mcp = checks.command && checks.bridge && await mcpProbe({ entry });
    const response = await fetchImpl(new URL("/v1/account/balance", gatewayUrl), { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
    checks.key = response.ok;
    checks.gateway = response.status < 500;
  } catch { /* only return named checks; never echo secrets */ }
  return { ok: Object.values(checks).every(Boolean), checks };
}

export async function installVerifiedWorkBuddyConfig({
  configPath,
  gatewayUrl,
  apiKey,
  allowedRoots,
  installDir,
  repair = false,
  now,
  fetchImpl = fetch,
  restrict = async () => {},
  mcpProbe = probeMcpEntry,
  afterVerified = async () => {}
}) {
  const installed = await installWorkBuddyConfig({ configPath, gatewayUrl, apiKey, allowedRoots, installDir, repair, migrateLegacy: false, now, restrictTemporary: restrict });
  let migrationBackupPath = null;
  try {
    await restrict(configPath);
    const diagnosis = await diagnoseWorkBuddyConfig({ configPath, gatewayUrl, apiKey, fetchImpl, mcpProbe });
    if (!diagnosis.ok) {
      const error = new Error("workbuddy_config_self_check_failed");
      error.code = "workbuddy_config_self_check_failed";
      error.checks = diagnosis.checks;
      throw error;
    }
    const verified = await readConfig(configPath);
    if (isLegacyImageBridge(verified.mcpServers?.["image-bridge"])) {
      const migrated = { ...verified, mcpServers: { ...verified.mcpServers } };
      delete migrated.mcpServers["image-bridge"];
      migrationBackupPath = await atomicSave(configPath, migrated, now, restrict);
      await restrict(configPath);
    }
    await afterVerified({ configPath, installed, diagnosis });
    if (migrationBackupPath) await unlink(migrationBackupPath).catch(() => {});
    return { ...installed, diagnosis };
  } catch (error) {
    await restoreWorkBuddyConfig({ configPath, backupPath: installed.backupPath });
    if (migrationBackupPath) await unlink(migrationBackupPath).catch(() => {});
    await restrict(configPath).catch(() => {});
    throw error;
  }
}
