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

自动流程优先从腾讯云下载固定版本的 bootstrap 和安装器，失败时改用 GitHub 同版本备份，并校验 HTTPS、文件大小和 SHA-256；带签名的后续版本还会校验 Authenticode 与精确发布者。安装器备份 WorkBuddy 配置、合并 `xiaoye-image` 并调用 `/v1/account/balance` 自检。只有新版自检成功后，才会移除指向 `xiaoyeai.cn` 的自有旧版 `image-bridge`；失败会恢复原配置。安装码通过当前用户临时文件传递，不进入 URL；长期 Key 不进入聊天、命令行或安装日志。

WorkBuddy 不能执行本机命令时，使用网站显示的腾讯云固定版本地址手动安装。个人 Key 只在登录后的“MCP Key”页面显示，不要把 Key 发到聊天或截图中。

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

生产 API 必须设置独立的 `INSTALLATION_TOKEN_PEPPER`、`WORKBUDDY_INSTALLER_VERSION=1.2.3`、腾讯云版本目录 `WORKBUDDY_RELEASE_BASE_URL` 和公开仓库 `WORKBUDDY_RELEASE_REPOSITORY=owner/repository`。腾讯云作为默认下载地址，GitHub Release 保存同版本备份：

- `workbuddy-image-mcp.ps1`
- `workbuddy-image-mcp-1.2.3.json`
- `WorkBuddy-Image-MCP-Setup-1.2.3.exe`

推送 `v1.2.3` 标签后，`.github/workflows/release.yml` 使用 Node.js 22 和 Inno Setup 只构建一次正式三件套，并运行打包后 bridge 握手与真实 EXE 初始化检查；三个文件完整、非空且清单哈希一致后才公开。随后从 GitHub Release 下载这三个原文件，不做修改或重新构建，人工上传到腾讯云 `releases/v1.2.3/` 目录。这样腾讯云和 GitHub 的 EXE 使用同一个 SHA-256。未签名 1.2.3 是公开内测版，Windows 可能显示“未知发布者”。

后端每 5 分钟检查一次腾讯云版本目录，校验 bootstrap 大于 1 KiB、EXE 大于 10 MiB、清单版本和下载地址一致。安装时再对实际 EXE 做 SHA-256 校验。检查未通过时，`GET /api/install-release/status` 返回未就绪，网站禁用提示词与下载操作，也不会签发新的 30 分钟一次性安装码。

本地构建只用于开发验证，不作为正式腾讯云文件。构建机需安装 Inno Setup 6，并显式提供公开仓库和测试下载目录：

```powershell
$env:WORKBUDDY_RELEASE_REPOSITORY = "owner/repository"
$env:WORKBUDDY_RELEASE_ROOT_URL = "https://download.example.com/releases"
npm run installer:build
```

如配置 `$env:CODE_SIGN_CERT_SHA1`，构建脚本会额外签名并验证发布者 `CN=Xiaoye AI`。安装后开始菜单提供“检测连接”和“修复配置”；卸载时只删除 `xiaoye-image` 条目。内测开放前确认腾讯云三件套可公开读取且哈希一致，并在一套无 Node.js 的干净 Windows 环境完成“复制提示词 → 授权 → 安装 → 开启 → `get_balance`”全流程。

## 主要接口

- 网站：`/api/auth/*`、`/api/wallet`、`/api/ledger`、`/api/recharge-*`、`/api/api-keys`、`/api/install-release/status`
- 管理：`/api/admin/recharge-*`、`/api/admin/payment-channels`、`/api/admin/users`、`/api/admin/manual-reviews`
- WorkBuddy：`POST /v1/generations`、`GET /v1/generations/:request_id`、`GET /v1/account/balance`
- 兼容：`POST /v1/bridge/generations` 和管理员旧 `/mcp`

完整产品约束、状态机和验收项见 `docs/superpowers/specs/2026-09-13-workbuddy-commercial-platform-design.md` 与 `docs/superpowers/plans/2026-09-13-workbuddy-commercial-platform.md`。
