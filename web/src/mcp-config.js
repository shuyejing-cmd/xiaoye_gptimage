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

export function installationPromptStatus({ copied }) {
  return copied ? "安装提示词已复制，请粘贴给 WorkBuddy" : "复制失败，请手动复制下方安装提示词";
}

export function formatInstallExpiry(value, locale = "zh-CN") {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
}
