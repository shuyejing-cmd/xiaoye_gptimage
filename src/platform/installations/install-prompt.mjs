function requireGitHubAsset(value, { version, fileName }) {
  let url;
  try { url = new URL(value); } catch { throw new Error("安装资源必须来自 GitHub Release"); }
  const expectedSuffix = `/releases/download/v${version}/${fileName}`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.endsWith(expectedSuffix) || url.search || url.hash || url.username || url.password) {
    throw new Error("安装资源必须来自固定版本的 GitHub Release");
  }
  return url.href;
}

export function buildWorkBuddyInstallPrompt({ installationToken, release }) {
  if (!/^wb_install_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]+$/.test(String(installationToken || ""))) throw new Error("安装码格式无效");
  const version = String(release?.version || "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("安装器版本格式无效");
  const bootstrapUrl = requireGitHubAsset(release.bootstrap_url, { version, fileName: "workbuddy-image-mcp.ps1" });
  const manifestUrl = requireGitHubAsset(release.manifest_url, { version, fileName: `workbuddy-image-mcp-${version}.json` });
  const installerUrl = requireGitHubAsset(release.installer_url, { version, fileName: `WorkBuddy-Image-MCP-Setup-${version}.exe` });

  return `请帮我安装 WorkBuddy 图片 MCP。只需向我请求一次本机命令执行权限，并严格按下面流程操作。

0. 先检查 WorkBuddy 是否已经存在名为 xiaoye-image 的 MCP，并调用 get_balance 验证它是否健康。若健康，停止重复安装并直接告诉我当前余额。
1. 若需要安装，先说明将下载并运行公开 GitHub Release 中的 WorkBuddy 图片 MCP 安装器，然后等待我确认本机命令执行权限。
2. 确认后，将下面的一次性安装码写入当前 Windows 用户临时目录中的新文件，并限制为仅当前用户可读。不要把安装码放入 URL 或进程参数：

\`\`\`text
${installationToken}
\`\`\`

3. 将 bootstrap 下载到当前用户临时目录。下载完成后必须确认文件非空（Length 大于 0）；如果为空，立即停止，不得运行。

Bootstrap URL：

\`\`\`text
${bootstrapUrl}
\`\`\`

Manifest URL：

\`\`\`text
${manifestUrl}
\`\`\`

4. 把实际临时文件路径替换进下面命令并执行，不要修改参数名：

\`\`\`powershell
powershell.exe -NoProfile -NonInteractive -File "<bootstrap>" -TokenFile "<token-file>" -ManifestUrl "<manifest-url>"
\`\`\`

5. 只有 PowerShell 退出码为 0，且去除首尾空白后的完整输出严格等于 installed，才可以报告安装成功。下载、验证或安装失败时不得声称成功，也不要手工拼接或覆盖 mcp.json。
6. 无论成功还是失败，都必须删除临时安装码文件和 bootstrap 文件。成功后提醒我在 WorkBuddy 中开启 xiaoye-image；如果没有出现，提醒我重启 WorkBuddy，然后调用 get_balance 确认连接。

如果你不能执行本机命令，不要猜测任何本机路径。请让我从下面的固定版本 GitHub Release 地址手动下载安装器：

\`\`\`text
${installerUrl}
\`\`\``;
}
