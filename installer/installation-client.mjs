import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const SAFE_CODES = new Set([
  "invalid_installation_token",
  "installation_token_expired",
  "installation_token_used",
  "api_key_invalid",
  "invalid_session",
  "account_suspended",
  "installations_unavailable",
  "rate_limited"
]);

export class InstallationClientError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "InstallationClientError";
    this.code = code;
  }
}

export async function verifyPrivateTokenFile(tokenFile) {
  if (process.platform !== "win32") return true;
  try {
    const script = [
      "$path=$env:WORKBUDDY_INSTALLATION_TOKEN_FILE",
      "if([string]::IsNullOrWhiteSpace($path)){exit 2}",
      "$acl=[System.IO.File]::GetAccessControl($path)",
      "$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User",
      "$owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier])",
      "if($owner.Value -ne $me.Value){exit 3}",
      "$rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])",
      "$unsafe=$rules | Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($me.Value,'S-1-5-18','S-1-5-32-544')}",
      "if($unsafe){exit 4}"
    ].join("; ");
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      env: { ...process.env, WORKBUDDY_INSTALLATION_TOKEN_FILE: tokenFile }
    });
    return true;
  } catch {
    return false;
  }
}

export async function restrictPrivateFile(path) {
  if (process.platform !== "win32") return;
  const username = process.env.USERNAME;
  if (!username) throw new InstallationClientError("windows_user_unavailable");
  try {
    await execFileAsync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${username}:(R,W)`], { windowsHide: true });
  } catch {
    throw new InstallationClientError("private_file_acl_failed");
  }
}

export function recoveredKeyFile(installDir) {
  return join(installDir, "installer", ".recovered-api-key");
}

export async function preserveRecoveredApiKey({ installDir, apiKey, restrict = restrictPrivateFile }) {
  const path = recoveredKeyFile(installDir);
  await mkdir(join(installDir, "installer"), { recursive: true });
  await writeFile(path, "", { mode: 0o600 });
  try {
    await restrict(path);
    await writeFile(path, apiKey, { mode: 0o600 });
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
  return path;
}

export async function readRecoveredApiKey(installDir) {
  try { return (await readFile(recoveredKeyFile(installDir), "utf8")).trim(); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function deleteRecoveredApiKey(installDir) {
  await unlink(recoveredKeyFile(installDir)).catch((error) => { if (error.code !== "ENOENT") throw error; });
}

function safeServerCode(payload) {
  const candidate = payload?.error?.code || payload?.error || payload?.code;
  return SAFE_CODES.has(candidate) ? candidate : "installation_exchange_rejected";
}

export async function exchangeInstallationToken({ gatewayUrl, tokenFile, fetchImpl = fetch, verifyTokenFile = verifyPrivateTokenFile }) {
  try {
    if (!(await verifyTokenFile(tokenFile))) throw new InstallationClientError("installation_token_file_insecure");
    const token = (await readFile(tokenFile, "utf8")).trim();
    if (!token) throw new InstallationClientError("installation_token_invalid");
    let response;
    try {
      response = await fetchImpl(new URL("/v1/installations/exchange", String(gatewayUrl).replace(/\/+$/, "") + "/"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ installation_token: token }),
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new InstallationClientError("installation_exchange_unavailable");
    }
    let payload = {};
    try { payload = await response.json(); } catch { /* map malformed bodies to a safe code */ }
    if (!response.ok) throw new InstallationClientError(safeServerCode(payload));
    const apiKey = payload.api_key || payload.apiKey;
    const resolvedGatewayUrl = payload.gateway_url || payload.gatewayUrl || String(gatewayUrl).replace(/\/+$/, "");
    if (!apiKey) throw new InstallationClientError("installation_exchange_invalid_response");
    return { apiKey, gatewayUrl: resolvedGatewayUrl };
  } finally {
    await unlink(tokenFile).catch(() => {});
  }
}
