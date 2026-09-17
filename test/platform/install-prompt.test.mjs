import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkBuddyInstallPrompt } from "../../src/platform/installations/install-prompt.mjs";

test("installation prompt contains a one-time token but never a long-lived key", () => {
  const prompt = buildWorkBuddyInstallPrompt({
    installationToken: "wb_install_public01_secret",
    release: {
      version: "1.2.0",
      bootstrap_url: "https://github.com/owner/repository/releases/download/v1.2.0/workbuddy-image-mcp.ps1",
      manifest_url: "https://github.com/owner/repository/releases/download/v1.2.0/workbuddy-image-mcp-1.2.0.json",
      installer_url: "https://github.com/owner/repository/releases/download/v1.2.0/WorkBuddy-Image-MCP-Setup-1.2.0.exe"
    }
  });
  assert.match(prompt, /wb_install_public01_secret/);
  assert.match(prompt, /先检查.*xiaoye-image.*健康.*停止重复安装/s);
  assert.match(prompt, /公开 GitHub Release/);
  assert.match(prompt, /等待我确认.*权限/);
  assert.match(prompt, /Length.*0|非空/);
  assert.match(prompt, /powershell\.exe -NoProfile -NonInteractive -File "<bootstrap>" -TokenFile "<token-file>" -ManifestUrl "<manifest-url>"/);
  assert.match(prompt, /退出码为 0.*installed/s);
  assert.match(prompt, /无论成功还是失败.*删除.*安装码.*bootstrap/s);
  assert.match(prompt, /```text\s+https:\/\/github\.com\/owner\/repository\/releases\/download\/v1\.2\.0\/workbuddy-image-mcp\.ps1\s+```/);
  assert.match(prompt, /WorkBuddy-Image-MCP-Setup-1\.2\.0\.exe/);
  assert.doesNotMatch(prompt, /wb_live_/);
});

test("installation prompt rejects malformed tokens and non-GitHub release URLs", () => {
  const release = {
    version: "1.2.0",
    bootstrap_url: "https://github.com/owner/repository/releases/download/v1.2.0/workbuddy-image-mcp.ps1",
    manifest_url: "https://github.com/owner/repository/releases/download/v1.2.0/workbuddy-image-mcp-1.2.0.json",
    installer_url: "https://github.com/owner/repository/releases/download/v1.2.0/WorkBuddy-Image-MCP-Setup-1.2.0.exe"
  };
  assert.throws(() => buildWorkBuddyInstallPrompt({ installationToken: "bad", release }), /安装码/);
  assert.throws(() => buildWorkBuddyInstallPrompt({ installationToken: "wb_install_public01_secret", release: { ...release, bootstrap_url: "https://example.com/bootstrap.ps1" } }), /GitHub/);
});
