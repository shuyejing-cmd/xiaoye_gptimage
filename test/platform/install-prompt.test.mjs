import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkBuddyInstallPrompt } from "../../src/platform/installations/install-prompt.mjs";

test("installation prompt contains a one-time token but never a long-lived key", () => {
  const prompt = buildWorkBuddyInstallPrompt({
    installationToken: "wb_install_public01_secret",
    release: {
      version: "1.2.1",
      bootstrap_url: "https://workbuddy-release.cos.ap-shanghai.myqcloud.com/releases/v1.2.1/workbuddy-image-mcp.ps1",
      manifest_url: "https://workbuddy-release.cos.ap-shanghai.myqcloud.com/releases/v1.2.1/workbuddy-image-mcp-1.2.1.json",
      installer_url: "https://workbuddy-release.cos.ap-shanghai.myqcloud.com/releases/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe",
      fallback_bootstrap_url: "https://github.com/owner/repository/releases/download/v1.2.1/workbuddy-image-mcp.ps1",
      fallback_manifest_url: "https://github.com/owner/repository/releases/download/v1.2.1/workbuddy-image-mcp-1.2.1.json",
      fallback_installer_url: "https://github.com/owner/repository/releases/download/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe"
    }
  });
  assert.match(prompt, /wb_install_public01_secret/);
  assert.match(prompt, /先检查.*xiaoye-image.*健康.*停止重复安装/s);
  assert.match(prompt, /腾讯云.*GitHub.*备用/s);
  assert.match(prompt, /未发现 xiaoye-image 是正常情况/);
  assert.match(prompt, /等待我确认.*权限/);
  assert.match(prompt, /Length.*0|非空/);
  assert.match(prompt, /powershell\.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<bootstrap>" -TokenFile "<token-file>" -ManifestUrl "<manifest-url>"/);
  assert.match(prompt, /退出码为 0.*installed/s);
  assert.match(prompt, /无论成功还是失败.*删除.*安装码.*bootstrap/s);
  assert.match(prompt, /```text\s+https:\/\/workbuddy-release\.cos\.ap-shanghai\.myqcloud\.com\/releases\/v1\.2\.1\/workbuddy-image-mcp\.ps1\s+```/);
  assert.match(prompt, /github\.com\/owner\/repository\/releases\/download\/v1\.2\.1\/workbuddy-image-mcp\.ps1/);
  assert.match(prompt, /重启 WorkBuddy.*新会话.*get_balance/s);
  assert.doesNotMatch(prompt, /wb_live_/);
});

test("installation prompt rejects malformed tokens and non-HTTPS release URLs", () => {
  const release = {
    version: "1.2.1",
    bootstrap_url: "https://download.example.com/releases/v1.2.1/workbuddy-image-mcp.ps1",
    manifest_url: "https://download.example.com/releases/v1.2.1/workbuddy-image-mcp-1.2.1.json",
    installer_url: "https://download.example.com/releases/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe",
    fallback_bootstrap_url: "https://github.com/owner/repository/releases/download/v1.2.1/workbuddy-image-mcp.ps1",
    fallback_manifest_url: "https://github.com/owner/repository/releases/download/v1.2.1/workbuddy-image-mcp-1.2.1.json",
    fallback_installer_url: "https://github.com/owner/repository/releases/download/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe"
  };
  assert.throws(() => buildWorkBuddyInstallPrompt({ installationToken: "bad", release }), /安装码/);
  assert.throws(() => buildWorkBuddyInstallPrompt({ installationToken: "wb_install_public01_secret", release: { ...release, bootstrap_url: "http://example.com/bootstrap.ps1" } }), /HTTPS/);
});
