import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildReleaseManifest } from "../../installer/release-manifest.mjs";

test("unsigned beta manifest exposes the Tencent installer and GitHub fallback", () => {
  assert.deepEqual(buildReleaseManifest({
    version: "1.2.1",
    sha256: "a".repeat(64),
    signed: false,
    installerUrl: "https://workbuddymcp-1354005482.cos.ap-shanghai.myqcloud.com/releases/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe",
    fallbackInstallerUrls: ["https://github.com/shuyejing-cmd/xiaoye_gptimage/releases/download/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe"]
  }), {
    version: "1.2.1",
    sha256: "a".repeat(64),
    channel: "beta",
    signed: false,
    installer_url: "https://workbuddymcp-1354005482.cos.ap-shanghai.myqcloud.com/releases/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe",
    fallback_installer_urls: ["https://github.com/shuyejing-cmd/xiaoye_gptimage/releases/download/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe"]
  });
});

test("bootstrap requires a manifest and verifies digest, result, and cleanup", async () => {
  const source = await readFile("installer/workbuddy-image-mcp-bootstrap.ps1", "utf8");
  assert.match(source, /\[Parameter\(Mandatory=\$true\)\]\[string\]\$ManifestUrl/);
  assert.match(source, /System\.Security\.Cryptography\.SHA256/);
  assert.match(source, /Invoke-DownloadWithRetry/);
  assert.match(source, /fallback_installer_urls/);
  assert.match(source, /if \(\$Manifest\.signed\)/);
  assert.match(source, /\$InstallerResult -ne 'installed'/);
  assert.ok(source.indexOf("$InstallerResult -match") < source.indexOf("$Process.ExitCode -ne 0"), "precise installer errors must be handled before the process exit code");
  assert.match(source, /finally\s*\{/);
  assert.doesNotMatch(source, /xiaoyeai\.cn\/install/);
});

test("bootstrap maps a missing token file before any download", { skip: process.platform !== "win32" }, async () => {
  const missing = join(tmpdir(), `wb-missing-bootstrap-token-${crypto.randomUUID()}.txt`);
  await assert.rejects(promisify(execFile)("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "installer/workbuddy-image-mcp-bootstrap.ps1",
    "-TokenFile", missing,
    "-ManifestUrl", "https://example.test/workbuddy-image-mcp-1.2.3.json"
  ], { windowsHide: true }), (error) => `${error.stdout || ""}${error.stderr || ""}`.includes("installation_token_file_insecure"));
});

test("build and workflow publish exactly the versioned GitHub release assets", async () => {
  const [build, workflow, smoke] = await Promise.all([
    readFile("installer/build-installer.ps1", "utf8"),
    readFile(".github/workflows/release.yml", "utf8"),
    readFile("installer/smoke-installer.ps1", "utf8")
  ]);
  assert.match(build, /WORKBUDDY_RELEASE_REPOSITORY/);
  assert.doesNotMatch(build, /web\\public/);
  assert.match(workflow, /v1\.2\.3/);
  assert.match(build, /WORKBUDDY_RELEASE_ROOT_URL/);
  assert.match(build, /v\$Version/);
  assert.match(workflow, /WORKBUDDY_RELEASE_ROOT_URL/);
  assert.match(workflow, /WORKBUDDY_RELEASE_ROOT_URL is required/);
  assert.match(workflow, /Smoke packaged bridge/);
  assert.match(workflow, /Smoke installer initialization/);
  assert.match(smoke, /installation_token_file_insecure/);
  assert.match(smoke, /\/GROUP=/);
  assert.doesNotMatch(smoke, /StartsWith\(\$SmokeRoot/);
  assert.doesNotMatch(smoke, /WorkBuddy \* MCP/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /npm test/);
  assert.doesNotMatch(workflow, /web:build/);
  for (const name of ["workbuddy-image-mcp.ps1", "workbuddy-image-mcp-1.2.3.json", "WorkBuddy-Image-MCP-Setup-1.2.3.exe"]) {
    assert.match(workflow, new RegExp(name.replaceAll(".", "\\.")));
  }
  assert.match(workflow, /--draft/);
  assert.match(workflow, /release delete/);
});

test("public package contains only the bridge runtime contract", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.version, "1.2.3");
  assert.equal(pkg.engines.node, ">=22.13.0");
  assert.equal(pkg.scripts.bridge, "node src/index.mjs");
  assert.equal(pkg.scripts.gateway, undefined);
});
