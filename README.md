# WorkBuddy 图片 MCP 商业化平台

这是只面向 WorkBuddy 的图片生成服务。用户通过邮箱登录网站，领取或充值积分，创建个人 MCP Key，再用 Windows 安装器把本地图片 bridge 合并进 WorkBuddy 配置。

## 组成

- `src/platform/index.mjs`：网站与 HTTP API，负责登录、Key、钱包、订单和生成任务入队。
- `src/platform/worker.mjs`：生成与对账 worker；调用 GPT.Ge 或 APIMart、保存临时图片、结算冻结积分。
- `src/index.mjs`：安装在用户电脑上的 stdio MCP bridge，只读取 `ALLOWED_IMAGE_ROOTS` 内的参考图。
- `web/`：React/Vite 用户网站与管理后台。
- `installer/`：包含 Node runtime 的 Inno Setup Windows 安装器。
- `ops/`：PostgreSQL 加密备份和恢复演练脚本。

PostgreSQL 是账户、钱包、账本、订单和任务状态的唯一事实来源。旧 SQLite 文件仅保留给旧 `/mcp` gateway，不迁移为已计费历史。

## 计费规则

- 符合防刷规则的新邮箱验证成功后赠送 20 积分；设备重复或同 IP 24 小时内超过 3 个验证账户时暂停自动奖励，待管理员核验后补发一次。首次充值不额外赠送。
- 1 元＝10 积分；套餐金额按每 ¥0.10 换算 1 积分，充值审核只入账一次，不再发首充奖励。
- 默认 2K medium 为 5 积分；1K low/medium/high 为 2/3/8，2K 为 3/5/15，4K 为 4/7/22，每张参考图另加 5 积分。创建任务时按实际报价原子减少可用积分并冻结同额积分；成功图片写入私有 COS 后才扣除冻结，明确失败全额释放，未知结果保持冻结。
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

复制 `.env.example` 为服务器上的 `.env`，填写数据库、两个独立 pepper、32 字节负载加密密钥、COS、SMTP，以及 APIMart 和 GPT.Ge 两份供应商 Key。不要把 `.env`、完整个人 Key、数据库备份或付款凭证提交到 Git。

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

APIMart 使用国内接口作为生产主供应商。服务器 `.env` 同时保存 APIMart 和 GPT.Ge 的 Key，以便手动切换后仍能对账两家的未完成任务：

```dotenv
IMAGE_PROVIDER=apimart
APIMART_API_KEY=replace-me
APIMART_BASE_URL=https://api.apib.ai/v1
APIMART_IMAGE_MODEL=gpt-image-2.5-sunburst
GPT_GE_API_KEY=replace-me
```

API 和 worker 直连 `api.apib.ai`；无需运行 Mihomo。APIMart 连通检查失败时，新生成请求在冻结积分前返回 503；已领取但尚未提交的任务会延后，不会自动切换 GPT.Ge。

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
curl -fsS https://your-domain.example/healthz
curl -fsS https://your-domain.example/readyz
```

从之前的 Mihomo 版本升级时，先备份现有 `.env` 和数据库。在切换前，先从**当前运行的 worker 容器**直连国内接口；命令只输出状态码，不输出 Key 或响应正文：

```bash
docker compose -p workbuddy-image-mcp --env-file .env exec -T worker node -e "fetch('https://api.apib.ai/v1/models',{headers:{Authorization:'Bearer '+process.env.APIMART_API_KEY},signal:AbortSignal.timeout(10000)}).then(r=>{console.log('APIMART_STATUS='+r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(2))"
```

确认返回成功后，编辑**现有** `.env`：明确设置 `IMAGE_PROVIDER=apimart` 和 `APIMART_BASE_URL=https://api.apib.ai/v1`，同时保留两份供应商 Key。旧文件若仍写着 `api.apimart.ai`，新代码不会覆盖该值。验证配置后重建服务并清理旧代理容器：

```bash
docker compose -p workbuddy-image-mcp --env-file .env config --quiet
docker compose -p workbuddy-image-mcp --env-file .env up -d --build --remove-orphans
docker compose -p workbuddy-image-mcp --env-file .env ps
```

确认新服务正常后，检查旧卷 `workbuddy-image-mcp_mihomo-data` 是否存在、属于本项目且已无容器使用；再用 `docker volume rm workbuddy-image-mcp_mihomo-data` 精确删除其中的旧订阅和控制密钥。不要使用 `down --volumes`，它会连 PostgreSQL 数据卷一起删除。最后从 worker 容器带服务端 Key 验证 `/v1/models`，再执行一次测试生成并核对账本。

人工回退时，将 `IMAGE_PROVIDER=gpt_ge` 后重建 API 和 worker；历史任务仍按数据库记录的原供应商对账。网站、登录和充值不依赖图片供应商的连通状态。

### 从生成次数切换到积分（数据库 v8）

这次升级不能沿用上面的 `up -d --build` 一步重建。先备份并验证可恢复，再暂停旧 API 接单和旧 worker；确认 `generation_jobs` 没有 `queued`、`submitting`、`provider_pending`、`output_persisting`、`unknown` 或 `manual_review` 任务。只启动新版 API，让它单独完成 v8 迁移并等待 `/readyz` 正常，之后再启动新版 worker。迁移在 PostgreSQL 事务中持有任务表锁并复查活跃任务；发现活跃任务会回滚，不能强行迁移。新版启动后逐笔核对钱包、冻结和账本：旧 1 次只换算成 5 积分一次，历史订单快照也只换算一次。确认后再发布新版安装包与 Skill；公开注册入口在验收完成前保持关闭。生产操作细节见 `docs/operations/production-launch-checklist.md`。

`/healthz` 只表示进程存活；`/readyz` 会检查 PostgreSQL 和钱包不变量。API 在钱包异常或未知任务积压达到门限时暂停接收新生成，但查询和后台复核仍可使用。

部署前还需要：

1. 把 `DOMAIN` 指向服务器并开放 80/443，让 Caddy 申请 HTTPS 证书。
2. 在 COS 设置私有读写、参考图和生成结果 24 小时生命周期、付款凭证 180 天生命周期。
3. 配置每日执行 `ops/backup-postgres.sh`，并定期用 `ops/restore-drill.sh` 验证恢复。
4. 配置日志采集和告警：钱包不变量、数据库不可用、`unknown`/`manual_review` 积压、队列等待时间和 provider 错误率。

## 用户如何接入 WorkBuddy

最简单的接入只有三步：

1. 在网站完成邮箱验证，并在“MCP Key”页面创建一个 Key。
2. 点击“复制安装提示词”，把整段内容发送给 WorkBuddy；提示词只含 30 分钟有效、只能使用一次的安装码，不含长期 Key。
3. WorkBuddy 说明操作后，允许一次本机命令执行。安装成功后开启 `xiaoye-image`；列表没有刷新时重启 WorkBuddy。

自动流程优先从腾讯云下载固定版本的 bootstrap 和安装器，失败时改用 GitHub 同版本备份，并校验 HTTPS、文件大小和 SHA-256；带签名的后续版本还会校验 Authenticode 与精确发布者。安装器备份 WorkBuddy 配置、合并 `xiaoye-image` 并调用 `/v1/account/balance` 自检。只有新版自检成功后，才会移除指向 `xiaoyeai.cn` 的自有旧版 `image-bridge`；失败会恢复原配置。安装码通过当前用户临时文件传递，不进入 URL；长期 Key 不进入聊天、命令行或安装日志。

WorkBuddy 不能执行本机命令时，使用网站显示的腾讯云固定版本地址手动安装。个人 Key 只在登录后的“MCP Key”页面显示，不要把 Key 发到聊天或截图中。

在 WorkBuddy 调用 `generate_image`；任务超过 90 秒时用 `get_generation` 查询，用 `get_balance` 查看可用、冻结积分与价目表。

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

`generate_image` 支持文生图以及 1–4 张 PNG/JPEG/WebP 参考图；单张最多 4 MiB，总顺序由 `reference_image_paths` 决定。分辨率支持 `auto`、`1k`、`2k`、`4k`，默认与 `auto` 均采用 `2k`；质量默认与 `auto` 均采用 `medium`。生成前冻结积分，成功交付才结算；每张参考图加 5 积分。

积分价格版本 1：1K 的 low/medium/high 为 2/3/8 分；2K 为 3/5/15 分；4K 为 4/7/22 分。默认 2K medium 为每张 5 分。比例和输出格式不加价；1 元充值兑换 10 积分，充值积分永久有效。服务端 `get_balance` 返回当前价格，不依赖 Skill 计算。

## 安装器发布

生产 API 必须设置独立的 `INSTALLATION_TOKEN_PEPPER`、`WORKBUDDY_INSTALLER_VERSION=1.2.5`、腾讯云版本目录 `WORKBUDDY_RELEASE_BASE_URL` 和公开仓库 `WORKBUDDY_RELEASE_REPOSITORY=owner/repository`。腾讯云作为默认下载地址，GitHub Release 保存同版本备份：

- `workbuddy-image-mcp.ps1`
- `workbuddy-image-mcp-1.2.5.json`
- `WorkBuddy-Image-MCP-Setup-1.2.5.exe`

推送 `v1.2.5` 标签后，`.github/workflows/release.yml` 使用 Node.js 22 和 Inno Setup 只构建一次正式三件套，并运行打包后 bridge 握手与真实 EXE 初始化检查；三个文件完整、非空且清单哈希一致后才公开。随后从 GitHub Release 下载这三个原文件，不做修改或重新构建，上传到腾讯云 `releases/v1.2.5/` 目录。这样腾讯云和 GitHub 的 EXE 使用同一个 SHA-256。未签名 1.2.5 是公开内测版，Windows 可能显示“未知发布者”。

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
