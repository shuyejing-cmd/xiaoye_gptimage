export function buildWorkBuddyInstallPrompt({ installationToken, version, origin }) {
  if (!/^wb_install_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]+$/.test(String(installationToken || ""))) throw new Error("安装码格式无效");
  const base = new URL(origin);
  if (base.protocol !== "https:") throw new Error("安装地址必须使用 HTTPS");
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ""))) throw new Error("安装器版本格式无效");
  const bootstrapUrl = new URL("/install/workbuddy-image-mcp.ps1", base).href;
  const manifestUrl = new URL(`/install/workbuddy-image-mcp-${version}.json`, base).href;
  const fallbackUrl = new URL("/downloads/WorkBuddy-Image-MCP-Setup.exe", base).href;
  return `请帮我安装 WorkBuddy 图片 MCP。执行前请先说明将下载并运行官方安装器，并等待我确认本机命令执行权限。

确认后请严格完成以下操作：
1. 将安装码 ${installationToken} 写入当前 Windows 用户临时目录中的新文件，并限制为仅当前用户可读；不要把安装码放入 URL 或进程参数。
2. 从 ${bootstrapUrl} 下载官方 bootstrap。
3. 使用 PowerShell -NoProfile 运行 bootstrap，传入 -TokenFile 指向临时安装码文件，并传入 -ManifestUrl '${manifestUrl}'。
4. 等待安装完成，原样告诉我安装结果。不要自己拼接或覆盖 mcp.json；安装器只能合并 xiaoye-image。
5. 成功后提醒我在 WorkBuddy 中开启 xiaoye-image；如果没有出现，提醒我重启 WorkBuddy。

如果你不能执行本机命令，请不要猜测路径，直接让我打开 ${fallbackUrl} 手动安装。`;
}
