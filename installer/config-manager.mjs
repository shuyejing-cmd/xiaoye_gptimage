import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function readConfig(configPath, repair = false) {
  try { return JSON.parse(await readFile(configPath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return {};
    if (repair && error instanceof SyntaxError) return {};
    throw new Error("WorkBuddy mcp.json 已损坏；请先使用修复配置功能");
  }
}

async function atomicSave(configPath, value, now = () => Date.now()) {
  await mkdir(dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.tmp-${process.pid}-${now()}`;
  const backupPath = `${configPath}.backup-${now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  let hadExisting = true;
  try { await access(configPath); } catch { hadExisting = false; }
  if (hadExisting) await rename(configPath, backupPath);
  try { await rename(temporaryPath, configPath); }
  catch (error) { if (hadExisting) await rename(backupPath, configPath); throw error; }
  return hadExisting ? backupPath : null;
}

export async function installWorkBuddyConfig({ configPath, gatewayUrl, apiKey, allowedRoots, installDir, repair = false, now }) {
  const current = await readConfig(configPath, repair);
  const next = { ...current, mcpServers: { ...(current.mcpServers || {}) } };
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
  return { config: next, backupPath: await atomicSave(configPath, next, now) };
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

export async function diagnoseWorkBuddyConfig({ configPath, gatewayUrl, apiKey, fetchImpl = fetch, exists = async (path) => { try { await access(path); return true; } catch { return false; } } }) {
  const checks = { json: false, entry: false, command: false, bridge: false, key: false, gateway: false };
  try {
    const config = await readConfig(configPath);
    checks.json = true;
    const entry = config.mcpServers?.["xiaoye-image"];
    checks.entry = Boolean(entry);
    checks.command = Boolean(entry?.command && await exists(entry.command));
    checks.bridge = Boolean(entry?.args?.[0] && await exists(entry.args[0]));
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
  restrict = async () => {}
}) {
  const installed = await installWorkBuddyConfig({ configPath, gatewayUrl, apiKey, allowedRoots, installDir, repair, now });
  try {
    await restrict(configPath);
    const diagnosis = await diagnoseWorkBuddyConfig({ configPath, gatewayUrl, apiKey, fetchImpl });
    if (!diagnosis.ok) {
      const error = new Error("workbuddy_config_self_check_failed");
      error.code = "workbuddy_config_self_check_failed";
      error.checks = diagnosis.checks;
      throw error;
    }
    return { ...installed, diagnosis };
  } catch (error) {
    await restoreWorkBuddyConfig({ configPath, backupPath: installed.backupPath });
    await restrict(configPath).catch(() => {});
    throw error;
  }
}
