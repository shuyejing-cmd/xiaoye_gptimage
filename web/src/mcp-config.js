export function installationPromptStatus({ copied }) {
  return copied ? "安装提示词已复制，请粘贴给 WorkBuddy" : "复制失败，请手动复制下方安装提示词";
}

export function formatInstallExpiry(value, locale = "zh-CN") {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
}
