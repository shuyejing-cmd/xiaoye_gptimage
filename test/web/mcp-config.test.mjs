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
