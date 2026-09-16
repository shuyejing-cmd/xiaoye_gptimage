# WorkBuddy 图片 MCP 商业化平台

这是只面向 WorkBuddy 的图片生成服务。用户通过邮箱登录网站，领取或充值生成额度，创建个人 MCP Key，再用 Windows 安装器把本地图片 bridge 合并进 WorkBuddy 配置。

## 组成

- `src/platform/index.mjs`：网站与 HTTP API，负责登录、Key、钱包、订单和生成任务入队。
- `src/platform/worker.mjs`：生成与对账 worker；调用 GPT.Ge 或 APIMart、保存临时图片、结算冻结额度。
- `src/index.mjs`：安装在用户电脑上的 stdio MCP bridge，只读取 `ALLOWED_IMAGE_ROOTS` 内的参考图。
- `web/`：React/Vite 用户网站与管理后台。
- `installer/`：包含 Node runtime 的 Inno Setup Windows 安装器。
- `ops/`：PostgreSQL 加密备份和恢复演练脚本。

PostgreSQL 是账户、钱包、账本、订单和任务状态的唯一事实来源。旧 SQLite 文件仅保留给旧 `/mcp` gateway，不迁移为已计费历史。

## 计费规则

- 新邮箱验证成功后发放 5 次额度；设备重复或同 IP 24 小时内超过 3 个验证账户时暂停自动奖励。
- 首笔审核通过的充值额外发放 10 次；唯一账本事件保证并发或重复审核不会重复发放。
- 创建任务时原子执行“可用 -1、冻结 +1”。成功图片写入私有 COS 后才扣除冻结；明确失败释放；未知结果保持冻结。
- 网络中断、上游可能已接单或 COS 上传结果不确定时不自动重提。对账 worker 查原任务或确定性 COS 对象；24 小时仍无法确认才进入人工复核。
- 成功图片只临时保存 24 小时。生产环境必须在 COS 为生成和参考图前缀配置 24 小时生命周期规则。

## 本地验证

要求 Node.js 22.13 或更高版本。

```powershell
npm install
npm test
npm run web:build
```

测试使用内存 PostgreSQL 兼容层，不需要本地数据库。正式发布前仍必须使用真实 PostgreSQL 执行迁移、并发和备份恢复验收。

## 生产配置

复制 `.env.example` 为服务器上的 `.env`，填写数据库、两个独立 pepper、32 字节负载加密密钥、COS、SMTP 和一个图片 provider。不要把 `.env`、完整个人 Key、数据库备份或付款凭证提交到 Git。

生成 32 字节 Base64 密钥示例：

```bash
openssl rand -base64 32
```

首次部署设置：

```dotenv
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
MCP_GATEWAY_TOKEN=existing-legacy-token
PUBLIC_REGISTRATION_ENABLED=false
```

启动时会把管理员邮箱提升为管理员，并把旧 token 以摘要形式导入该账户。观察期保持公开注册关闭，现有用户仍可用邮箱登录；完成 48 小时核对后再将开关改为 `true`。导入确认后仍应保留兼容观察期，再轮换旧 token。

## Docker Compose 部署

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
curl -fsS https://your-domain.example/healthz
curl -fsS https://your-domain.example/readyz
```

`/healthz` 只表示进程存活；`/readyz` 会检查 PostgreSQL 和钱包不变量。API 在钱包异常或未知任务积压达到门限时暂停接收新生成，但查询和后台复核仍可使用。

部署前还需要：

1. 把 `DOMAIN` 指向服务器并开放 80/443，让 Caddy 申请 HTTPS 证书。
2. 在 COS 设置私有读写、参考图和生成结果 24 小时生命周期、付款凭证 180 天生命周期。
3. 配置每日执行 `ops/backup-postgres.sh`，并定期用 `ops/restore-drill.sh` 验证恢复。
4. 配置日志采集和告警：钱包不变量、数据库不可用、`unknown`/`manual_review` 积压、队列等待时间和 provider 错误率。

## 用户如何接入 WorkBuddy

最简单的接入只有三步：

1. 在网站完成邮箱验证，并在“MCP Key”页面创建一个 Key。
2. 点击“复制安装提示词”，把整段内容发送给 WorkBuddy；提示词只含 10 分钟有效、只能使用一次的安装码，不含长期 Key。
3. WorkBuddy 说明操作后，允许一次本机命令执行。安装成功后开启 `xiaoye-image`；列表没有刷新时重启 WorkBuddy。

自动流程会下载固定版本的官方 bootstrap 和安装器，校验 HTTPS、SHA-256、有效 Authenticode 签名及精确发布者，然后备份 WorkBuddy 配置、只合并 `xiaoye-image` 并调用 `/v1/account/balance` 自检。安装码通过当前用户临时文件传递，不进入 URL；长期 Key 不进入聊天、命令行或安装日志。

WorkBuddy 不能执行本机命令时，使用网站的“下载安装器”手动安装。仍无法安装时，可在“MCP Key”页面复制完整 JSON 配置作为最后兜底；只有手动兜底需要直接处理 Key，不要把 Key 发到聊天或截图中。

在 WorkBuddy 调用 `generate_image`；任务超过 90 秒时用 `get_generation` 查询，用 `get_balance` 查看可用与冻结额度。

手动开发配置可使用 `IMAGE_API_KEY`；`IMAGE_GATEWAY_TOKEN` 仅为旧配置兼容：

```json
{
  "mcpServers": {
    "xiaoye-image": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/path/to/project/src/index.mjs"],
      "env": {
        "ALLOWED_IMAGE_ROOTS": "C:/Users/NAME/Pictures",
        "IMAGE_GATEWAY_URL": "https://xiaoyeai.cn",
        "IMAGE_API_KEY": "wb_live_..."
      }
    }
  }
}
```

`generate_image` 支持文生图以及 1–4 张 PNG/JPEG/WebP 参考图；单张最多 4 MiB，总顺序由 `reference_image_paths` 决定。APIMart 模式仍只支持一张参考图，多图会明确拒绝。

## 安装器发布

生产 API 必须设置独立的 `INSTALLATION_TOKEN_PEPPER`，并发布与 `WORKBUDDY_INSTALLER_VERSION` 一致的安装器。当前协议版本为 1.1.0，固定地址和版本地址分别为：

- `https://xiaoyeai.cn/install/workbuddy-image-mcp.ps1`
- `https://xiaoyeai.cn/install/workbuddy-image-mcp-1.1.0.json`
- `https://xiaoyeai.cn/install/WorkBuddy-Image-MCP-Setup-1.1.0.exe`

构建机需安装 Inno Setup 6。未配置证书时只生成本地测试包，不会写入网站目录；设置证书 SHA-1 后，脚本按“构建 → 安装器和 bootstrap 的 Authenticode 签名 → 验证签名和精确发布者 → SHA-256 → 清单 → 发布”的顺序执行。bootstrap 当前固定要求发布者主题为 `CN=Xiaoye AI`；正式购买证书后的主题必须与其完全一致，否则应在发布前审查并同时更新 bootstrap 与构建脚本中的固定值。

```powershell
$env:CODE_SIGN_CERT_SHA1 = "certificate-thumbprint"
npm run installer:build
```

安装后开始菜单提供“检测连接”和“修复配置”；卸载时只删除 `xiaoye-image` 条目。公开发布前必须在 Windows 10/11 的干净用户、无 Node.js、已有多个 MCP、默认/自定义配置路径和自定义安装目录中验证。还必须分别验证 WorkBuddy 允许命令执行时自动完成，以及禁止命令执行时正确展示手动下载兜底。

## 主要接口

- 网站：`/api/auth/*`、`/api/wallet`、`/api/ledger`、`/api/recharge-*`、`/api/api-keys`
- 管理：`/api/admin/recharge-*`、`/api/admin/payment-channels`、`/api/admin/users`、`/api/admin/manual-reviews`
- WorkBuddy：`POST /v1/generations`、`GET /v1/generations/:request_id`、`GET /v1/account/balance`
- 兼容：`POST /v1/bridge/generations` 和管理员旧 `/mcp`

完整产品约束、状态机和验收项见 `docs/superpowers/specs/2026-09-13-workbuddy-commercial-platform-design.md` 与 `docs/superpowers/plans/2026-09-13-workbuddy-commercial-platform.md`。
