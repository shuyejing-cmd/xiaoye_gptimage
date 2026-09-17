export function installationPromptStatus({ copied }) {
  return copied ? "安装提示词已复制，请粘贴给 WorkBuddy" : "复制失败，请手动复制下方安装提示词";
}

export function formatInstallExpiry(value, locale = "zh-CN") {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function installReleaseView(status, loadError = "") {
  if (loadError) return { ready: false, label: "无法确认安装服务状态，请刷新页面后重试", installerUrl: null };
  if (!status) return { ready: false, label: "正在检查安装服务…", installerUrl: null };
  if (status.ready) return { ready: true, label: `安装服务已就绪 · v${status.version}`, installerUrl: status.installer_url || null };
  return { ready: false, label: status.message || "安装服务准备中", installerUrl: null };
}
