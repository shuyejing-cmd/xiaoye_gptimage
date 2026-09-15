import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkBuddyInstallPrompt } from "../../src/platform/installations/install-prompt.mjs";

test("installation prompt contains a one-time token but never a long-lived key", () => {
  const prompt = buildWorkBuddyInstallPrompt({
    installationToken: "wb_install_public01_secret",
    version: "1.1.0",
    origin: "https://xiaoyeai.cn"
  });
  assert.match(prompt, /wb_install_public01_secret/);
  assert.match(prompt, /https:\/\/xiaoyeai\.cn\/install\/workbuddy-image-mcp\.ps1/);
  assert.match(prompt, /执行前.*确认/);
  assert.match(prompt, /TokenFile/);
  assert.match(prompt, /WorkBuddy-Image-MCP-Setup\.exe/);
  assert.doesNotMatch(prompt, /wb_live_/);
});

test("installation prompt rejects unsafe origins and malformed tokens", () => {
  assert.throws(() => buildWorkBuddyInstallPrompt({ installationToken: "bad", version: "1.1.0", origin: "https://xiaoyeai.cn" }), /安装码/);
  assert.throws(() => buildWorkBuddyInstallPrompt({ installationToken: "wb_install_public01_secret", version: "1.1.0", origin: "http://xiaoyeai.cn" }), /HTTPS/);
});
