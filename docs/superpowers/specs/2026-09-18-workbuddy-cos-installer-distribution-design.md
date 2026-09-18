# WorkBuddy 安装文件腾讯云分发设计

## 目标

保持用户安装流程不变：用户在网站创建个人 Key，复制一次性安装提示词，交给 WorkBuddy 并确认一次本机操作，重启 WorkBuddy 后使用 `get_balance` 验证连接。

解决当前三个实际阻断：GitHub 在国内下载缓慢或中断、Windows 默认脚本执行限制、临时安装码文件继承复杂权限后被拒绝。

本次发布使用新版本 `1.2.1`，不修改已经公开的 `1.2.0` 文件或标签。

## 用户流程

1. 用户登录 `xiaoyeai.cn`，创建或选择一个个人 Key。
2. 网站签发一个 30 分钟有效、只能使用一次的安装码，并生成安装提示词。
3. 用户把提示词发送给 WorkBuddy，确认一次本机命令执行。
4. WorkBuddy 优先从腾讯云下载；腾讯云不可用时尝试 GitHub 备用地址。
5. 安装器完成配置、自检和旧 `image-bridge` 迁移，只在完整成功时返回 `installed`。
6. WorkBuddy 提醒用户重启并开启 `xiaoye-image`；新会话调用 `get_balance` 验证，不承诺当前会话立即出现新工具。

安装提示词明确说明：未发现 `xiaoye-image` 是正常情况，应继续安装；安装码属于当前用户且只能使用一次，不得转发。

## 文件分发

### 腾讯云主源

新建一个只保存公开安装文件的独立 COS 存储桶，不复用保存用户参考图、生成结果或付款凭证的私有存储桶。存储桶保持“私有写”，只允许 `releases/` 前缀匿名读取。

固定版本目录：

```text
releases/v1.2.1/
├─ workbuddy-image-mcp.ps1
├─ workbuddy-image-mcp-1.2.1.json
└─ WorkBuddy-Image-MCP-Setup-1.2.1.exe
```

`1.2.1` 发布前绑定 `download.xiaoyeai.cn` 并配置 HTTPS；如开启国内 CDN，则为该域名配置 CNAME。代码通过环境变量读取主下载域名，不写死存储桶名称。COS 默认 HTTPS 域名仅用于运维检查，不进入用户提示词。

所有对象使用固定版本路径，不允许覆盖。EXE 上传时保存文件大小和 SHA-256 自定义元数据。上传顺序为 EXE、bootstrap、manifest；manifest 最后上传，作为该版本完整发布的标志。

### GitHub 备用源

公开 GitHub 仓库继续发布同版本的三个文件。GitHub 不再是国内用户的默认下载地址，但保留源码审计、版本留档和腾讯云故障回退能力。

`v1.2.1` 的 GitHub Release 和 COS 文件必须来自同一次构建，EXE SHA-256 必须一致。

## 发布文件协议

`1.2.1` manifest 保留现有字段，并增加备用地址：

```json
{
  "version": "1.2.1",
  "sha256": "<64位小写SHA-256>",
  "channel": "beta",
  "signed": false,
  "installer_url": "https://download.xiaoyeai.cn/releases/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe",
  "fallback_installer_urls": [
    "https://github.com/shuyejing-cmd/xiaoye_gptimage/releases/download/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe"
  ]
}
```

bootstrap 只接受配置允许的腾讯云 HTTPS 主域名和固定 GitHub Release 地址。它按“腾讯云主源重试三次，再尝试 GitHub”的顺序下载，每次请求都有超时；任何来源下载完成后都必须执行文件大小和 SHA-256 校验。

当前内测安装包仍为未签名版本，实际安全链为固定 HTTPS 地址、固定版本和 SHA-256。未来 manifest 的 `signed` 变为 `true` 后，再额外执行发布者证书校验。

## Windows 安装可靠性

安装提示词提供经过测试的明确命令，并加入当前进程范围的：

```text
-ExecutionPolicy Bypass
```

它只允许本次安装命令运行，不修改系统或用户的长期 PowerShell 设置。

WorkBuddy 在当前用户临时目录创建本次安装专用子目录，先关闭权限继承并只授权当前用户、SYSTEM 和 Administrators，再写入安装码。bootstrap 在读取安装码前再次收紧并验证权限。无论成功或失败，安装码、bootstrap、manifest、EXE、结果文件和专用临时目录都必须删除。

提示词要求在一次已授权的安装流程内完成下载、验证、执行和清理，不再让用户逐条确认。若 WorkBuddy 本身仍按命令拆分权限，必须如实提示，不能声称一定只弹一次。

长期 `wb_live_` Key 仍然只由安装器通过一次性安装码从服务器兑换，不进入提示词、下载地址或安装命令。

## 后端发布状态

后端不下载完整 EXE。状态检查缓存五分钟，并验证：

- COS manifest 可下载、版本为 `1.2.1`；
- COS bootstrap 大于 1 KiB；
- COS EXE 大于 10 MiB；
- COS EXE 的 SHA-256 元数据与 manifest 一致；
- 主下载 URL 使用允许的 HTTPS 域名和固定版本路径。

COS 主源完整时允许签发提示词。GitHub 备用源状态作为附加信息，不因 GitHub 在国内暂时不可达而阻止腾讯云安装。

状态响应继续兼容现有网站字段，并增加备用地址供提示词生成：

```json
{
  "ready": true,
  "version": "1.2.1",
  "manifest_url": "https://download.xiaoyeai.cn/releases/v1.2.1/workbuddy-image-mcp-1.2.1.json",
  "bootstrap_url": "https://download.xiaoyeai.cn/releases/v1.2.1/workbuddy-image-mcp.ps1",
  "installer_url": "https://download.xiaoyeai.cn/releases/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe",
  "fallback_manifest_url": "https://github.com/shuyejing-cmd/xiaoye_gptimage/releases/download/v1.2.1/workbuddy-image-mcp-1.2.1.json",
  "fallback_bootstrap_url": "https://github.com/shuyejing-cmd/xiaoye_gptimage/releases/download/v1.2.1/workbuddy-image-mcp.ps1",
  "fallback_installer_url": "https://github.com/shuyejing-cmd/xiaoye_gptimage/releases/download/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe"
}
```

网络失败、文件缺失、大小异常或哈希不一致时，网站显示“安装服务准备中”，不签发新的安装提示词。每个外部检查都有明确超时，不能让页面长期卡住。

## 错误提示

提示词和安装器至少给出以下可执行建议：

- 安装码过期或已经使用：回网站点击“重新生成”。
- 账户被冻结：联系管理员处理账户状态。
- WorkBuddy 配置位置不明确：让用户选择实际的 `mcp.json`。
- 配置文件损坏：保持原文件和备份，不覆盖，提示用户修复 JSON。
- 本地自检失败：恢复旧配置，保留旧 `image-bridge`。
- 腾讯云与 GitHub 均下载失败：不执行安装器，提示稍后重试或手动下载。
- 安装成功但工具未出现：重启 WorkBuddy，在新会话开启 `xiaoye-image` 并调用 `get_balance`。

## 发布自动化

`v1.2.1` 标签触发一次构建：

1. 运行全量测试并构建一个 EXE。
2. 计算 SHA-256，生成同时包含腾讯云主地址和 GitHub备用地址的 manifest。
3. 检查三个文件非空，EXE 大于 10 MiB。
4. 创建 GitHub Release 并上传三个文件。
5. 使用 GitHub Secrets 中仅有发布存储桶写权限的腾讯云凭据上传 COS；顺序为 EXE、bootstrap、manifest。
6. 从 COS 匿名地址重新读取 manifest/bootstrap，并读取 EXE 元数据完成发布后校验。

任何阶段失败都不把该版本标记为可安装。腾讯云密钥、用户 Key、安装码和服务端 `.env` 不进入仓库或构建产物。

## 测试与验收

自动测试覆盖：

- 安装提示词优先腾讯云并包含 GitHub 备用地址；
- 命令包含进程范围的 `ExecutionPolicy Bypass`；
- 未发现现有 MCP 时继续安装；
- 安装码文件继承复杂 Temp ACL 时仍能被收紧并通过验证；
- 腾讯云第一次或第二次下载失败后可重试成功；
- 腾讯云全部失败后回退 GitHub；
- 任一来源下载的 EXE 哈希错误都不执行；
- 所有来源失败时不报告成功；
- 安装码只兑换一次，长期 Key 不出现在提示词、参数和日志；
- 后端状态检查不下载完整 EXE，并在超时后返回不可用；
- 当前旧 `image-bridge` 只在新版自检成功后移除。

人工验收使用一套没有 Node.js、PowerShell 执行策略为 Restricted、Temp 目录带继承权限的干净 Windows 环境，完整执行：

```text
创建 Key
→ 复制提示词
→ WorkBuddy 请求权限
→ 腾讯云下载并安装
→ 重启 WorkBuddy
→ 开启 xiaoye-image
→ get_balance 成功
```

再人为阻断腾讯云主域名，验证同一版本能够回退 GitHub；最后同时阻断两个来源，确认不会出现假成功。

## 需要用户完成的云端配置

- 新建独立 COS 发布存储桶，并提供存储桶名称和地域。
- 将 `releases/` 设置为允许匿名读取，其他写操作保持私有。
- 如使用 `download.xiaoyeai.cn`，配置自定义域名、HTTPS 和可选 CDN。
- 创建仅能写入该发布存储桶 `releases/` 前缀的腾讯云发布凭据，并保存到 GitHub Secrets。

这些配置完成前，现有 `v1.2.0` GitHub 安装仍保留，但网站不向普通用户开放新的 `1.2.1` 安装提示词。

## 参考

- 腾讯云 COS 支持按存储桶、对象或前缀开放匿名读取：https://cloud.tencent.com/document/product/436/68285
- 腾讯云 COS 支持绑定自定义域名和 CDN：https://cloud.tencent.com/document/product/436/18670
- 腾讯云 COS 支持对象自定义元数据：https://cloud.tencent.com/document/product/436/112236
