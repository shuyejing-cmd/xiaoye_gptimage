# WorkBuddy 图片 MCP 商业化平台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有个人图片 MCP 升级为只面向 WorkBuddy 的可注册、可充值、可靠计费商业服务。

**Architecture:** Fastify API 与独立 generation/reconciliation worker 共用 PostgreSQL；React/Vite 提供网站；个人 Key 驱动本地 bridge；私有 COS 只保存短期输入、输出和人工付款凭证。

**Tech Stack:** Node.js 22、Fastify、PostgreSQL、React/Vite、MCP SDK、Zod、腾讯 COS、Caddy、Docker Compose、SMTP。

**Spec:** `docs/superpowers/specs/2026-09-13-workbuddy-commercial-platform-design.md`

## Global Constraints

- 成功交付一张图片才扣 1 次；明确失败释放，未知状态冻结 24 小时后人工复核。
- 注册奖励 5 次，首笔充值奖励 10 次，均由唯一账本事件保证只发放一次。
- 不记录明文提示词、完整 Key、图片内容或签名 URL；生成结果 24 小时自动删除。
- 新接口保持现有 WorkBuddy bridge、旧 token 和旧端点的过渡兼容。

---

### Task 1: PostgreSQL 基线与迁移

- [x] 先为迁移顺序、约束和重复执行写失败测试。
- [x] 增加连接池、事务辅助器、迁移运行器和用户、钱包、账本、任务、订单、Key、会话、审计表。
- [x] 将 PostgreSQL、迁移命令和 readiness 检查接入 Docker Compose。
- [x] 运行聚焦测试和旧全量测试并提交。

### Task 2: 邮箱认证、公开注册和奖励

- [x] 先测试验证码期限、尝试次数、重复验证、注册奖励唯一性和 IP/设备奖励限制。
- [x] 实现邮箱验证码、会话 Cookie、用户状态、管理员角色和 SMTP 适配器。
- [x] 验证每个合格账户只得到一次 5 额度并提交。

### Task 3: 钱包与不可变账本

- [x] 先测试冻结、扣除、释放、人工调整、并发余额和重复业务事件。
- [x] 实现钱包行锁、credit hold、账本唯一约束与余额不变量。
- [x] 用并发测试证明余额不会为负且同一事件只生效一次并提交。

### Task 4: 异步生成、幂等和对账

- [x] 先测试相同幂等键只调用一次 provider，以及成功、明确失败、未知、COS/数据库故障分支。
- [x] 将生成改为 PostgreSQL 队列；API 原子冻结额度，worker 领取任务并调用现有 provider。
- [x] 实现加密任务负载、确定性 COS 对象键、成功结算、失败释放和 24 小时人工复核。
- [x] 增加 `POST /v1/generations`、状态与余额接口，保留旧端点别名并提交。

### Task 5: 个人 Key 与 WorkBuddy MCP

- [x] 先测试 Key 只显示一次、摘要鉴权、撤销、最多三个和用户隔离。
- [x] 新增 `get_generation`、`get_balance`；bridge 生成并复用幂等键。
- [x] 兼容 `IMAGE_GATEWAY_TOKEN`，新版优先 `IMAGE_API_KEY` 并提交。

### Task 6: 人工收款码支付

- [x] 先测试套餐快照、付款凭证、重复审核、首次充值奖励和管理员审计。
- [x] 实现 `PaymentProvider` 边界、`manual_qr`、固定套餐、订单状态机与付款截图私有存储。
- [x] 确认钱包入账和订单审批在同一事务中并提交。

### Task 7: 网站与管理后台

- [x] 先测试所有 API 的未登录、越权、用户隔离和管理员授权。
- [x] 构建登录、余额、账本、充值、Key、安装说明与管理员审核页面。
- [x] 确保网站不展示生成图片或明文敏感数据并提交。

### Task 8: Windows 安装器

- [x] 先测试配置合并、备份、失败恢复、卸载和诊断命令。
- [x] 打包 Node runtime、bridge 与安装脚本，验证 Key 后原子合并 `%USERPROFILE%\.workbuddy\mcp.json`。
- [ ] 产出可测试安装包；代码签名作为公开发布门禁并提交。

### Task 9: 部署、监控与上线门禁

- [x] 增加 liveness/readiness、结构化日志、队列/钱包告警、备份与清理脚本。
- [ ] 导入管理员旧 token，完成数据库迁移、模拟故障、真实生成和人工充值验收。
- [ ] 全量测试、构建和安全检查通过后，观察 48 小时再开放公开注册。
