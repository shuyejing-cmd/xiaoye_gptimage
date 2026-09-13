# WorkBuddy 图片 MCP 商业化平台设计

## 目标

在现有 WorkBuddy 图片桥接器和图片网关上增加公开邮箱注册、个人 API Key、预付额度、可靠生成计费、人工收款码充值、管理后台和 Windows 安装器。首期只面向 WorkBuddy，不提供网页生图或公开远程 MCP。

## 已确认的产品规则

- 邮箱验证码注册，验证后赠送 5 次生成额度；首笔审核通过的充值再赠送 10 次。
- 额度永久有效；每成功交付一张图片扣 1 次，明确失败不扣，未知结果冻结并在 24 小时后人工复核。
- 固定套餐由管理员配置。首期显示收款码，用户上传付款截图，管理员审核入账。
- 生成图只在私有 COS 临时保留 24 小时，不建设作品库；提示词只为异步处理加密暂存，终态即删除。
- Windows 安装器包含 bridge 运行环境，用户粘贴个人 Key 后自动合并 WorkBuddy MCP 配置。

## 架构

Fastify API 负责网站会话、个人 Key、钱包、订单和任务查询；独立 worker 从 PostgreSQL 领取生成任务，调用现有 provider 客户端并将验证后的图片写入私有 COS。钱包和任务在同一 PostgreSQL 事务边界内更新。Caddy 提供 TLS 和静态网站，React/Vite 提供用户控制台与管理后台。

本地 bridge 为每次工具调用生成 `Idempotency-Key`，请求断线重试复用该值。网关以用户和幂等键唯一约束任务；成功必须同时满足图片验证、COS 写入和数据库扣费事务完成。无法确定上游是否受理时不得重提，保持冻结并交由对账。

## 数据与安全

PostgreSQL 是用户、钱包、不可变账本、充值订单、API Key 和生成任务的唯一事实来源。完整 API Key、验证码和网站 session token 只以带服务端 pepper 的摘要保存。提示词采用 AES-256-GCM 加密暂存；日志不记录提示词、图片、完整 Key、付款截图、签名 URL 或上游敏感正文。

付款实现通过 `PaymentProvider` 边界与钱包隔离。`manual_qr` 只负责付款说明、凭证和管理员确认；未来自动支付只需产生相同的 `payment_confirmed` 事件。

## 兼容与交付

保留 `/v1/bridge/generations` 和 `IMAGE_GATEWAY_TOKEN` 一次版本周期，新版使用 `/v1/generations` 和 `IMAGE_API_KEY`。部署时将现有管理员 token 导入新账户，旧 SQLite 只读归档，不迁移历史未计费任务。

公开上线前必须通过并发幂等、钱包不变量、崩溃恢复、未知任务对账、重复充值审核、用户隔离、数据清理和 WorkBuddy 安装器回归。
