# WorkBuddy 图片生成 MCP：0→1 设计

## 目标

让用户在 WorkBuddy 中输入生图提示词，并可附带一张本机参考图。WorkBuddy 只调用一次本机 MCP 工具；工具返回最终图片 URL。

第一版使用 APIMart 的异步 `gpt-image-2-official` 接口。APIMart API Key 只保存在腾讯云。

## 已验证的前提

`probe_local_image` 已在 WorkBuddy 中真实调用成功，并读取到用户上传 JPEG 的本机绝对路径、文件大小、MIME 类型和 SHA-256。因此本机 stdio MCP 可作为参考图传输层。

## 范围

包含：

- WorkBuddy 本机 stdio MCP 桥接器。
- 腾讯云上部署的图片网关与远程 MCP 端点。
- 一张本机 PNG/JPEG/WebP 参考图的上传、临时保存和图生图。
- 文生图、第三方异步任务轮询和最终图片 URL 返回。
- `1k`、`2k` 分辨率；单次一张图；最多等待 90 秒。
- 单人使用的 Bearer Token 鉴权、SQLite 任务记录和健康检查。

不包含：

- 用户系统、OAuth、计费、配额、管理后台。
- 4K、生图批量数量大于 1、蒙版、透明背景、多参考图。
- 对生成结果的长期存储或转存。

## 架构

```text
WorkBuddy
  │ stdio MCP: generate_image(prompt, reference_image_path?)
  ▼
本机 image-bridge
  │ HTTPS multipart + Bearer Token
  ▼
腾讯云 image-gateway
  ├─ 校验请求，保存任务状态（SQLite）
  ├─ 参考图上传 COS，生成第三方可读取的短期 URL
  ├─ 调 APIMart POST /v1/images/generations
  ├─ 轮询 GET /v1/tasks/{task_id}
  └─ 返回第三方最终图片 URL
  ▼
APIMart / gpt-image-2-official
```

腾讯云网关同时保留标准 Streamable HTTP MCP 入口，供 Claude、Cursor 等其他 Agent 直接做文生图；WorkBuddy 使用本机桥接器以支持本地参考图。

## 本机桥接器

### 工具契约

`generate_image` 参数：

```json
{
  "prompt": "必填",
  "reference_image_path": "可选，本机绝对路径",
  "size": "可选，默认 1:1",
  "resolution": "可选，1k 或 2k，默认 1k",
  "quality": "可选，默认 medium",
  "output_format": "可选，默认 png"
}
```

工具描述要求 WorkBuddy：当用户在当前任务中上传参考图时，传入该图的绝对路径；否则省略 `reference_image_path`。

### 行为与限制

- 只读取 `ALLOWED_IMAGE_ROOTS` 配置目录中的文件；解析真实路径后再判断，避免路径穿越和符号链接绕过。
- 仅接受 PNG、JPEG、WebP；基于文件头检测，不信任文件扩展名。
- 单图上限 20 MB；不持久化图片，也不保存 APIMart 或 COS 密钥。
- 无参考图时，发送 JSON 文生图请求；有参考图时，以 multipart 向网关上传图片与参数。
- 网关的最终响应被直接转换为 MCP 文本结果。桥接器不轮询第三方、不保存任务状态。

## 腾讯云图片网关

### 对外端点

- `POST /mcp`、`GET /mcp`：标准 Streamable HTTP MCP，供远程客户端文本生图。
- `POST /v1/bridge/generations`：仅桥接器使用的 HTTPS multipart 端点，供本机参考图生图。
- `GET /healthz`：容器健康检查。

`/mcp` 和 `/v1/bridge/generations` 均要求 `Authorization: Bearer <token>`。第一版为个人服务，使用同一个随机网关 Token；APIMart Key 永不离开服务器。

### 统一生图核心

两种入口都调用同一个 generation service：

1. 校验 `prompt`、比例、`1k/2k`、质量和格式；拒绝 4K、`n != 1`、蒙版、透明背景。
2. 若收到参考图，上传私有 COS 对象，生成至少覆盖任务时长的签名 URL。
3. 写入 SQLite 任务记录，再调用 APIMart `POST /v1/images/generations`，模型固定为 `gpt-image-2-official`。
4. 获得 `task_id` 后立即持久化；每 2 秒查询任务状态，最长 90 秒。
5. `completed` 时提取 `data.result.images[0].url[0]`，返回 URL；任务失败或超时则返回明确错误。
6. 查询可短暂重试；提交请求不自动重试，避免网络不确定时重复扣费。
7. 参考图对象在终态后删除；同时配置 COS 生命周期作为兜底。

第三方图片 URL 按其 `expires_at` 使用，不转存输出图片。

### 状态记录

SQLite 仅记录：本地请求 ID、第三方 `task_id`、状态、创建/完成时间、最终 URL、错误摘要。它不记录提示词正文或图片字节。

## 部署

- Node.js 容器运行 image-gateway。
- Caddy 或 Nginx 提供 HTTPS 和 `/mcp`、`/v1/bridge/generations` 路由。
- Docker Compose 注入 `APIMART_API_KEY`、`MCP_GATEWAY_TOKEN`、COS 凭据、SQLite 数据卷和配置。
- 本机桥接器仅需 Node.js、桥接器目录及 `IMAGE_GATEWAY_URL`、`IMAGE_GATEWAY_TOKEN`；由 WorkBuddy 的 `mcp.json` 自动启动。

## 错误体验

- 本机路径缺失、非图片、超过 20 MB、路径不在允许目录：桥接器直接返回可操作错误，绝不上传。
- 网关鉴权失败：提示本机令牌配置错误。
- APIMart 400/401/402/403/429/5xx：保留安全的错误类别和建议，不回显密钥或原始敏感信息。
- 90 秒未完成：返回“未在等待期完成”，不自动再次提交。
- 图片 URL 过期：说明第三方链接有效期已结束，需要重新生成。

## 验收

1. WorkBuddy 加载本机 `image-bridge`，能发现并调用 `generate_image`。
2. 纯文字 `1k` 请求在 90 秒内返回可访问图片 URL。
3. WorkBuddy 上传一张 JPEG/PNG/WebP 后，桥接器上传并以其作为参考图生成。
4. 4K、两张以上参考图、非图片和超过 20 MB 文件被明确拒绝。
5. APIMart 的任务失败、限流、网络查询失败和超时均返回可读错误，且不重复提交。
6. Claude/Cursor 可配置腾讯云 `/mcp` 端点并完成文字生图。

## 测试策略

- 单元测试：本机图片路径、允许目录、格式和大小验证；参数校验；APIMart 响应解析。
- MCP 集成测试：stdio bridge 工具发现与调用；远程 Streamable HTTP 工具发现与调用。
- 网关集成测试：mock APIMart 的提交、轮询成功、失败、429、超时场景。
- 手工端到端：WorkBuddy 文字生图、WorkBuddy 上传参考图生图、远程 MCP 文生图，各一次真实请求。
