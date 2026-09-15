# WorkBuddy 提示词引导安装设计

## 目标

把 WorkBuddy 图片 MCP 的正常安装流程压缩为：用户创建个人 Key 后，在网站复制一段安装提示词，粘贴给 WorkBuddy，确认一次本机执行权限，最后按提示启用 MCP 或重启 WorkBuddy。用户不需要判断 Node.js、安装目录、图片目录或 `mcp.json` 路径。

网站继续保留“下载安装器”和“复制完整 JSON 配置”作为兼容与故障恢复入口，但不把它们作为首选流程。

## 用户流程

1. 用户登录网站并创建至少一个有效个人 Key。
2. 用户点击“生成安装提示词”。网站创建一个 10 分钟有效、只能兑换一次的安装码，并返回包含该安装码的提示词。
3. 用户把提示词发送给 WorkBuddy。
4. WorkBuddy 向用户说明将下载并运行官方安装程序，然后请求一次命令执行权限。
5. WorkBuddy 下载官方安装器和对应的 SHA-256 清单，通过 HTTPS、摘要及 Authenticode 发布者校验后运行静默安装。
6. 安装器用安装码向服务器兑换指定个人 Key。长期 Key 不进入聊天提示词、命令行参数或下载 URL。
7. 安装器探测 WorkBuddy 配置，备份原文件，只合并 `xiaoye-image`，验证 JSON 后原子替换。
8. 安装器调用 `/v1/account/balance` 验证连接，并执行本地 MCP 自检。
9. WorkBuddy 输出明确结果：“安装成功，请开启 xiaoye-image”；如 WorkBuddy 无法动态加载，则提示用户重启。

## 方案结构

```text
网站个人 Key 页面
└─ 创建一次性安装码
   └─ 生成可复制的 WorkBuddy 安装提示词

WorkBuddy
└─ 用户确认执行权限
   └─ 下载并验证官方 bootstrap/安装器
      └─ 使用一次性安装码启动

Windows 安装器
├─ 兑换个人 Key
├─ 探测 WorkBuddy 配置位置
├─ 探测自身实际安装路径
├─ 合并 xiaoye-image 配置
├─ 验证 Key、余额和 MCP 启动
└─ 返回结构化安装结果
```

网站负责身份、安装码和提示词；安装器负责所有与本机路径有关的工作。网站生成的 JSON 不再作为自动安装的事实来源。

## 一次性安装码

新增 `installation_tokens`：

- `id`
- `user_id`
- `api_key_id`
- `session_id`
- `token_prefix`
- `token_hash`
- `expires_at`
- `consumed_at`
- `created_at`

安装码格式为 `wb_install_<公开前缀>_<随机密钥>`。数据库仅保存 HMAC 摘要，不保存完整安装码。创建、兑换和作废均记录安全审计事件。

规则：

- 有效期 10 分钟。
- 只能兑换一次；并发兑换只有一个请求成功。
- 只能兑换创建时选定且仍为 active 的 Key。
- 用户退出创建它的网站会话、撤销目标 Key 或账户被冻结后，安装码立即失效。
- 每用户每分钟最多创建 3 个安装码，同时最多保留 5 个未过期安装码。
- 兑换成功返回长期 Key，但响应只允许安装器使用，并设置 `Cache-Control: no-store`。

新增接口：

```text
POST /api/api-keys/:id/installation-token
POST /v1/installations/exchange
```

第一个接口要求网站会话并返回安装提示词；第二个接口使用安装码，不使用网站 Cookie。

## 安装提示词契约

网站生成一段短而确定的中文提示词，其中只包含：

- 官方安装地址；
- 安装码；
- 预期发布者和 SHA-256 清单地址；
- 要求 WorkBuddy 在执行前征得用户许可；
- 禁止修改 `xiaoye-image` 之外的 MCP；
- 安装失败时原样展示安装器的安全错误码和下一步。

提示词不包含长期个人 Key、不要求模型自己拼接 JSON，也不要求模型猜测系统路径。提示词提供 Windows PowerShell 自动安装命令和一个“不能执行命令时请打开安装包下载页”的回退说明。

## 安装器与路径探测

现有 Inno Setup 包继续包含固定版本的 Node runtime 和 bridge。安装器安装到 Windows 返回的实际 `{app}`，再由 `config-manager` 使用该真实目录生成 `command` 与 `args`，因此不依赖 `C:/Program Files/...` 的硬编码结果。

WorkBuddy 配置按以下顺序探测：

1. 安装命令明确传入的 `--config`；
2. `%USERPROFILE%\.workbuddy\mcp.json`；
3. 注册表或 WorkBuddy 官方可查询的配置位置（如果当前版本提供）；
4. 已运行 WorkBuddy 进程旁可识别的用户配置位置；
5. 无法唯一确定时弹出文件选择器，不擅自写入任何候选文件。

首期默认允许读取 `%USERPROFILE%\Pictures`。安装完成后的“修复配置”继续允许用户更换目录。所有路径均在本机解析并规范化；服务器不接收用户本机路径。

配置写入继续遵守现有约束：先解析原 JSON、创建带时间戳的备份、只更新 `mcpServers.xiaoye-image`、写入同目录临时文件、重新解析验证、原子替换。任何一步失败都保留或恢复原配置。

## Bootstrap 执行方式

为了让提示词短且可维护，WorkBuddy 不直接执行一大段内联 PowerShell。官网提供一个固定地址的签名 bootstrap，例如：

```text
https://xiaoyeai.cn/install/workbuddy-image-mcp.ps1
```

bootstrap 仅完成：下载清单与安装器、校验 SHA-256、验证 Authenticode 发布者、从标准输入或当前用户临时文件读取安装码、启动安装器、删除临时文件、输出安装结果。提示词优先要求 WorkBuddy 用文件工具创建仅当前用户可读的临时安装码文件，再把文件路径交给 bootstrap；安装码不得进入 URL 或安装器进程参数。安装码可能保留在用户主动发送的 WorkBuddy 对话与工具审计中，因此必须保持短时、单次有效。长期个人 Key 不得进入提示词、PowerShell 历史或安装日志。

生产环境只允许安装已签名版本。清单随安装器版本发布，网站生成提示词时固定版本号，避免用户在复制后下载到不同二进制文件。

## 成功和失败结果

安装器使用稳定错误码并附中文说明：

- `installed`：配置已写入且 Key、余额和 MCP 自检通过。
- `permission_required`：WorkBuddy 未获得执行权限，展示手动下载入口。
- `installer_verification_failed`：摘要或发布者校验失败，立即停止。
- `installation_token_expired`：回网站重新生成安装提示词。
- `installation_token_used`：安装码已经兑换，回网站重新生成。
- `api_key_invalid`：目标 Key 已撤销或账户不可用，不修改配置。
- `workbuddy_config_not_found`：让用户选择 `mcp.json`。
- `workbuddy_config_invalid`：原文件损坏，保留原件并进入修复流程。
- `gateway_unavailable`：不覆盖现有有效配置，提示稍后重试。
- `restart_required`：安装成功，但需要重启 WorkBuddy 才能加载。

只有完成配置写入、余额验证和本地 MCP 自检后才报告安装成功。安装码已兑换但后续失败时，安装器将已取得的 Key 保存在仅当前 Windows 用户可读的恢复文件中，供同一次安装或修复流程继续使用；不会要求服务器重新展示安装码。

## 网站界面

个人 Key 页面中每个 active Key 显示三个操作，按优先级排列：

1. `复制安装提示词`（主按钮）
2. `下载安装器`
3. `复制完整配置`

点击主按钮时才创建安装码。按钮反馈区明确显示“提示词已复制，粘贴给 WorkBuddy”，并显示 10 分钟有效期。完整 Key 仍按现有规则登录后可查看，但不嵌入安装提示词。

安装向导页面改成三步：创建 Key、复制提示词、允许执行并启用 MCP。下方提供手动安装与 JSON 配置折叠区。

## 测试与验收

必须覆盖：

- 同一安装码 20 个并发兑换请求只有一个成功。
- 过期、已用、已退出创建会话、撤销 Key 和冻结账户的安装码均不能兑换。
- 安装提示词不包含长期 Key、Cookie 或其他用户数据。
- bootstrap 对错误摘要、错误发布者、HTTP 降级和下载中断全部拒绝执行。
- 默认路径、自定义安装路径、自定义 WorkBuddy 配置路径均生成真实可执行配置。
- 已有多个 MCP 时只更新 `xiaoye-image`。
- 配置损坏、写入中断和自检失败时原文件可恢复。
- 长期 Key 不出现在提示词、命令行、URL、安装日志或进程列表；安装码不进入 URL 和安装器进程参数，并在过期或兑换后失效。
- WorkBuddy 可执行命令时完成提示词安装；不可执行时正确引导到手动安装器。
- 未安装 Node.js 的 Windows 10/11 x64 环境能够完成安装并调用 `get_balance`。

## 首期边界

- 只支持 Windows 10/11 x64 和 WorkBuddy。
- 不让大模型直接编辑 `mcp.json`。
- 不支持 macOS、Linux、Claude 或 Cursor。
- 不实现浏览器协议唤起本地安装器。
- 不自动替用户点击 WorkBuddy 的最终启用开关。
- WorkBuddy 路径探测以已验证的配置位置为准；无法唯一判断时必须让用户选择。
