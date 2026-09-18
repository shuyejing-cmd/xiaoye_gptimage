function requireVersionedAsset(value, { version, fileName, github = false }) {
  let url;
  try { url = new URL(value); } catch { throw new Error("安装资源必须使用有效 HTTPS 地址"); }
  const expectedSuffix = github
    ? `/releases/download/v${version}/${fileName}`
    : `/${fileName}`;
  if (url.protocol !== "https:" || (github && url.hostname !== "github.com") || !url.pathname.endsWith(expectedSuffix) || url.search || url.hash || url.username || url.password) {
    throw new Error(github ? "备用安装资源必须来自固定版本的 GitHub Release" : "安装资源必须使用固定版本的 HTTPS 地址");
  }
  return url.href;
}

export function buildWorkBuddyInstallPrompt({ installationToken, release }) {
  if (!/^wb_install_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]+$/.test(String(installationToken || ""))) throw new Error("安装码格式无效");
  const version = String(release?.version || "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("安装器版本格式无效");
  const bootstrapUrl = requireVersionedAsset(release.bootstrap_url, { version, fileName: "workbuddy-image-mcp.ps1" });
  const manifestUrl = requireVersionedAsset(release.manifest_url, { version, fileName: `workbuddy-image-mcp-${version}.json` });
  const installerUrl = requireVersionedAsset(release.installer_url, { version, fileName: `WorkBuddy-Image-MCP-Setup-${version}.exe` });
  const fallbackBootstrapUrl = requireVersionedAsset(release.fallback_bootstrap_url || release.bootstrap_url, { version, fileName: "workbuddy-image-mcp.ps1", github: true });
  const fallbackManifestUrl = requireVersionedAsset(release.fallback_manifest_url || release.manifest_url, { version, fileName: `workbuddy-image-mcp-${version}.json`, github: true });
  const fallbackInstallerUrl = requireVersionedAsset(release.fallback_installer_url || release.installer_url, { version, fileName: `WorkBuddy-Image-MCP-Setup-${version}.exe`, github: true });

  return `请帮我安装 WorkBuddy 图片 MCP。只需向我请求一次本机命令执行权限，并严格按下面流程操作。

0. 先检查 WorkBuddy 是否已经存在名为 xiaoye-image 的 MCP。未发现 xiaoye-image 是正常情况，直接继续安装；若已经存在、get_balance 可用且连接健康，则停止重复安装并告诉我当前余额。
1. 说明将优先从腾讯云下载公开安装文件，腾讯云失败时使用 GitHub 备用地址，然后等待我确认本机命令执行权限。
2. 确认后，在当前 Windows 用户临时目录中新建本次安装专用目录，把下面的一次性安装码写入 token.txt。安装码只属于当前账户、30 分钟有效且只能使用一次，不要转发，也不要放入 URL 或进程参数：

\`\`\`text
${installationToken}
\`\`\`

3. 优先下载腾讯云 bootstrap；失败时下载 GitHub 备用 bootstrap。下载完成后确认文件非空（Length 大于 0），否则停止，不得运行。

腾讯云 bootstrap：

\`\`\`text
${bootstrapUrl}
\`\`\`

GitHub 备用 bootstrap：

\`\`\`text
${fallbackBootstrapUrl}
\`\`\`

腾讯云 manifest：

\`\`\`text
${manifestUrl}
\`\`\`

GitHub 备用 manifest：

\`\`\`text
${fallbackManifestUrl}
\`\`\`

4. bootstrap 和 manifest 必须使用同一来源。把实际临时文件路径和选中的 manifest 地址替换进下面命令并执行，不要修改参数名：

\`\`\`powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<bootstrap>" -TokenFile "<token-file>" -ManifestUrl "<manifest-url>"
\`\`\`

5. 只有 PowerShell 退出码为 0，且去除首尾空白后的完整输出严格等于 installed，才可以报告安装成功。失败时不得声称成功，也不要手工拼接或覆盖 mcp.json。
6. 无论成功还是失败，都删除本次临时目录中的安装码和 bootstrap。成功后提醒我重启 WorkBuddy，在新会话中开启 xiaoye-image，再调用 get_balance 确认连接。

如果你不能执行本机命令，不要猜测任何本机路径。请让我先从腾讯云手动下载安装器：

\`\`\`text
${installerUrl}
\`\`\`

腾讯云下载失败时使用 GitHub 备用地址：

\`\`\`text
${fallbackInstallerUrl}
\`\`\``;
}
