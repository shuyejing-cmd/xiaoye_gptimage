import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export class WorkBuddyConfigDiscoveryError extends Error {
  constructor(code) {
    super(code);
    this.name = "WorkBuddyConfigDiscoveryError";
    this.code = code;
  }
}

export function defaultDiscoveryCandidates(env = process.env) {
  return [
    env.APPDATA && join(env.APPDATA, "WorkBuddy", "mcp.json"),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "WorkBuddy", "mcp.json"),
    env.USERPROFILE && join(env.USERPROFILE, "workbuddy", "mcp.json")
  ].filter(Boolean);
}

async function defaultExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function isValidCandidate(path, { exists, readText }) {
  if (!(await exists(path))) return false;
  try {
    const value = JSON.parse(await readText(path));
    return Boolean(value && typeof value === "object" && !Array.isArray(value)
      && value.mcpServers && typeof value.mcpServers === "object" && !Array.isArray(value.mcpServers));
  } catch {
    return false;
  }
}

export async function discoverWorkBuddyConfig({
  explicitPath,
  userProfile = process.env.USERPROFILE,
  candidatePaths = defaultDiscoveryCandidates(),
  exists = defaultExists,
  readText = (path) => readFile(path, "utf8")
} = {}) {
  if (explicitPath) return { configPath: explicitPath, source: "explicit" };

  const defaultPath = userProfile ? join(userProfile, ".workbuddy", "mcp.json") : null;
  if (defaultPath && await exists(defaultPath)) return { configPath: defaultPath, source: "default" };

  const uniqueCandidates = [...new Set(candidatePaths.filter(Boolean).map(String))];
  const valid = [];
  for (const path of uniqueCandidates) {
    if (await isValidCandidate(path, { exists, readText })) valid.push(path);
  }
  if (valid.length === 1) return { configPath: valid[0], source: "discovered" };
  throw new WorkBuddyConfigDiscoveryError(valid.length > 1 ? "workbuddy_config_ambiguous" : "workbuddy_config_not_found");
}
