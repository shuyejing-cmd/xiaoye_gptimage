# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React/Vite 用户网站与管理后台；Node.js 22、Fastify、PostgreSQL、腾讯 COS、Docker Compose 和 Caddy 服务端。该技术栈由用户提供的实施计划确认。

## Users

主要用户是在 Windows 上使用 WorkBuddy、需要稳定调用图片生成服务的个人用户。他们通过网站注册、充值并取得个人 Key，再通过一键安装器把服务接入 WorkBuddy。管理员负责套餐、收款码、人工充值审核、账本调整和异常生成任务复核。

## Product Purpose

把现有 WorkBuddy 图片 MCP 变成可公开注册、充值和稳定计费的服务。成功意味着用户可以从邮箱注册一路完成获取 Key、安装配置、充值、生成和查询结果；每一笔额度变化都可追溯且不会因为重试或故障重复发生。

## Positioning

服务只面向 WorkBuddy 的图片生成工作流，计费依据不是“请求发出”，而是“受支持图片完成校验、写入私有 COS 并成功结算”这一可审计交付事实。

## Operating Context

用户在网站管理账户、额度、订单和 Key，在 Windows 安装器中粘贴 Key 并授权参考图目录，随后主要在 WorkBuddy 对话中调用 `generate_image`、`get_generation` 和 `get_balance`。首期付款通过微信或支付宝收款码及付款截图完成，由管理员人工审核。

## Capabilities and Constraints

- 邮箱验证码公开注册，合格账户赠送 5 次；首次成功充值再赠送 10 次。
- 一张成功交付的图片扣 1 次；明确失败释放额度，未知结果保持冻结并对账。
- 不建设作品库，不长期保存明文提示词、参考图或生成图片；生成结果 24 小时有效。
- 用户最多拥有 3 个有效个人 Key。首期不公开支持 Claude、Cursor，也不提供网页直接生图。
- 支付采用可替换 provider；首期只有人工收款码，不接自动支付回调。
- 套餐价格与额度均由管理员配置，当前没有可对外展示的具体价格。

## Brand Commitments

产品名称为 WorkBuddy 图片 MCP。面对用户的文案使用简体中文，语气直接、可靠、避免夸大。个人 Key、图片隐私和扣费结果必须清楚说明。

## Evidence on Hand

产品规则、架构、接口、状态机、验收标准和边界来自 `docs/superpowers/specs/2026-09-13-workbuddy-commercial-platform-design.md` 与 `docs/superpowers/plans/2026-09-13-workbuddy-commercial-platform.md`。目前没有品牌 Logo、客户案例、评价、公开价格或商业数据；界面不得虚构这些内容。

## Product Principles

- 只有可验证的成功交付才扣费。
- 每个状态和每笔额度变化都能查明来源。
- WorkBuddy 内的使用路径应短，安装和修复应可自助完成。
- 密钥和图片默认私密，并尽量缩短敏感数据寿命。
- 管理员操作必须可审计，但不能绕过钱包账本。

## Accessibility & Inclusion

网站需支持键盘操作、清晰焦点、足够对比度、响应式布局和不依赖颜色单独表达状态。
