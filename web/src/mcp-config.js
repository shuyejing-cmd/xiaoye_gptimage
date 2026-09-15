export function buildWorkBuddyMcpConfig(apiKey) {
  return {
    mcpServers: {
      "xiaoye-image": {
        command: "C:/Program Files/WorkBuddy Image MCP/runtime/node.exe",
        args: ["C:/Program Files/WorkBuddy Image MCP/app/src/index.mjs"],
        env: {
          ALLOWED_IMAGE_ROOTS: "%USERPROFILE%/Pictures",
          IMAGE_GATEWAY_URL: "https://xiaoyeai.cn",
          IMAGE_API_KEY: apiKey
        }
      }
    }
  };
}

export function formatWorkBuddyMcpConfig(apiKey) {
  return JSON.stringify(buildWorkBuddyMcpConfig(apiKey), null, 2);
}
