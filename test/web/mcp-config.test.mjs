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
