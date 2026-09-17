import test from "node:test";
import assert from "node:assert/strict";

let mcpConfig;
try { mcpConfig = await import("../../web/src/mcp-config.js"); }
catch { mcpConfig = {}; }

test("formats prompt expiry without exposing full MCP configuration", () => {
  assert.equal(typeof mcpConfig.buildWorkBuddyMcpConfig, "undefined");
  assert.equal(typeof mcpConfig.formatWorkBuddyMcpConfig, "undefined");
  const localExpiry = new Date(2026, 8, 16, 12, 10, 0);
  assert.match(mcpConfig.formatInstallExpiry(localExpiry, "zh-CN"), /12:10/);
});

test("formats prompt installation feedback and expiry", () => {
  assert.equal(mcpConfig.installationPromptStatus({ copied: true }), "安装提示词已复制，请粘贴给 WorkBuddy");
  assert.equal(mcpConfig.installationPromptStatus({ copied: false }), "复制失败，请手动复制下方安装提示词");
  const localExpiry = new Date(2026, 8, 15, 12, 10, 0);
  assert.match(mcpConfig.formatInstallExpiry(localExpiry, "zh-CN"), /12:10/);
});

test("normalizes release status for ready, pending, and network failure states", () => {
  assert.deepEqual(mcpConfig.installReleaseView({ ready: true, version: "1.2.0", installer_url: "https://github.com/owner/repo/setup.exe" }), {
    ready: true,
    label: "安装服务已就绪 · v1.2.0",
    installerUrl: "https://github.com/owner/repo/setup.exe"
  });
  assert.equal(mcpConfig.installReleaseView({ ready: false, version: "1.2.0", message: "安装服务准备中" }).label, "安装服务准备中");
  assert.equal(mcpConfig.installReleaseView(null).label, "正在检查安装服务…");
  assert.equal(mcpConfig.installReleaseView(null, "网络不可用").label, "无法确认安装服务状态，请刷新页面后重试");
});
