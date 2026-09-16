import test from "node:test";
import assert from "node:assert/strict";

let mcpConfig;
try { mcpConfig = await import("../../web/src/mcp-config.js"); }
catch { mcpConfig = {}; }

test("builds a complete paste-ready WorkBuddy MCP configuration", () => {
  assert.equal(typeof mcpConfig.buildWorkBuddyMcpConfig, "function");
  const config = mcpConfig.buildWorkBuddyMcpConfig("wb_live_public_secret");
  assert.deepEqual(config, {
    mcpServers: {
      "xiaoye-image": {
        command: "C:/Program Files/WorkBuddy Image MCP/runtime/node.exe",
        args: ["C:/Program Files/WorkBuddy Image MCP/app/src/index.mjs"],
        env: {
          ALLOWED_IMAGE_ROOTS: "%USERPROFILE%/Pictures",
          IMAGE_GATEWAY_URL: "https://xiaoyeai.cn",
          IMAGE_API_KEY: "wb_live_public_secret"
        }
      }
    }
  });
  assert.equal(JSON.parse(mcpConfig.formatWorkBuddyMcpConfig("wb_live_public_secret")).mcpServers["xiaoye-image"].env.IMAGE_API_KEY, "wb_live_public_secret");
});

test("formats prompt installation feedback and expiry", () => {
  assert.equal(mcpConfig.installationPromptStatus({ copied: true }), "安装提示词已复制，请粘贴给 WorkBuddy");
  assert.equal(mcpConfig.installationPromptStatus({ copied: false }), "复制失败，请手动复制下方安装提示词");
  const localExpiry = new Date(2026, 8, 15, 12, 10, 0);
  assert.match(mcpConfig.formatInstallExpiry(localExpiry, "zh-CN"), /12:10/);
});
