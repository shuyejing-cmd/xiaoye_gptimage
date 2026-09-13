# WorkBuddy Image MCP

This project has two components:

- `src/index.mjs`: a local stdio MCP bridge for WorkBuddy. It reads one to four user-selected reference images only from `ALLOWED_IMAGE_ROOTS`, then sends them to the gateway over HTTPS.
- `src/gateway/index.mjs`: the remote gateway. It invokes the selected image provider, stores the generated image privately in COS, and returns a signed image URL.

It supports text-to-image and image-to-image with one to four PNG/JPEG/WebP reference images. Each reference image is limited to 4 MiB (16 MiB total); 4k, masks, and transparent backgrounds are not supported.

## Image providers

Both providers remain in the codebase. The server runs one selected provider at a time through `IMAGE_PROVIDER`:

- `apimart` (default): uses the original asynchronous APIMart task API.
- `gpt_ge`: uses `https://api.gpt.ge/v1`; both text-to-image and image-to-image normalize the provider result, validate its image bytes, store it privately in COS, and return a COS signed URL.

For `gpt_ge`, its API documentation limits every generated image edge to 840px and requires multiples of 16. The gateway therefore maps the supported aspect ratios to a maximum 832px edge. Its reference image endpoint also has a 4 MiB limit, enforced before any provider request. The gateway accepts documented Base64 results plus common compatible URL, Base64-alias, and Data URL result shapes; it validates image bytes and stores every successful result in private COS before returning a signed URL. Provider URLs must resolve to public HTTPS addresses and are checked again after redirects.
## Reference images

The local `image-bridge.generate_image` tool accepts either the legacy single-image field or the new ordered list:

```json
{
  "prompt": "Blend the subjects into one studio portrait",
  "reference_image_paths": [
    "C:/Users/NAME/Pictures/person.png",
    "C:/Users/NAME/Pictures/style.jpg"
  ],
  "size": "3:2",
  "quality": "medium",
  "output_format": "png"
}
```

- Use `reference_image_paths` for 1–4 images, in the exact order in which GPT.Ge should receive them.
- `reference_image_path` remains available for old one-image callers. Do not send both fields in the same request.
- Every path must be inside `ALLOWED_IMAGE_ROOTS`, point to a PNG/JPEG/WebP file, and be no larger than 4 MiB.
- More than four images, an oversize file, or an unsupported path is rejected before the provider is called.
- With `IMAGE_PROVIDER=apimart`, exactly one reference image remains supported. Requests with two or more images fail explicitly instead of silently dropping extras.


## Deploy on Tencent Cloud

The release archive deliberately excludes `.env`. Create the application directory and upload the archive from your own computer:

```powershell
ssh ubuntu@118.25.152.249 "mkdir -p /opt/workbuddy-image-mcp"
scp -P 10022 .\workbuddy-image-mcp.tar.gz ubuntu@118.25.152.249:/opt/workbuddy-image-mcp/
ssh -p 10022 ubuntu@118.25.152.249 "cd /opt/workbuddy-image-mcp && tar -xzf workbuddy-image-mcp.tar.gz && cp .env.example .env"
```

Replace `ubuntu` if your server uses another SSH user. Fill `/opt/workbuddy-image-mcp/.env` only on the server. Never put this file in Git or send it in chat.

For APIMart (the current default):

```dotenv
DOMAIN=xiaoyeai.cn
IMAGE_PROVIDER=apimart
APIMART_API_KEY=
APIMART_BASE_URL=https://api.apimart.ai/v1
MCP_GATEWAY_TOKEN=
COS_SECRET_ID=
COS_SECRET_KEY=
COS_BUCKET=aiyingxiao-1354005482
COS_REGION=ap-shanghai
COS_PREFIX=workbuddy-reference-images
PORT=3000
SQLITE_PATH=data/tasks.sqlite
```

To switch the running server to the new GPT.Ge provider, keep the common MCP/COS values and set:

```dotenv
IMAGE_PROVIDER=gpt_ge
GPT_GE_API_KEY=
GPT_GE_BASE_URL=https://api.gpt.ge/v1
```

Keeping the old `APIMART_API_KEY` in `.env` is safe but no longer required while `IMAGE_PROVIDER=gpt_ge`. Switching back only requires changing `IMAGE_PROVIDER=apimart` and ensuring its key is present.

After `.env` is complete or changed, run on the server:

```bash
cd /opt/workbuddy-image-mcp
sudo docker compose up -d --build
sudo docker compose ps
curl -fsS https://xiaoyeai.cn/healthz
```

Expected health response: `{"status":"ok"}`.

## WorkBuddy local bridge

Configure WorkBuddy to start the local bridge (replace the paths and token):

```json
{
  "mcpServers": {
    "image-bridge": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/path/to/image-mcp/src/index.mjs"],
      "env": {
        "ALLOWED_IMAGE_ROOTS": "C:/Users/NAME/Pictures",
        "IMAGE_GATEWAY_URL": "https://xiaoyeai.cn",
        "IMAGE_GATEWAY_TOKEN": "same-value-as-MCP_GATEWAY_TOKEN"
      }
    }
  }
}
```

The remote MCP endpoint for text-only use is `https://xiaoyeai.cn/mcp`. It requires `Authorization: Bearer <MCP_GATEWAY_TOKEN>`.
## 上游生图错误提示

生图被拒绝不一定表示 MCP 已断开。gateway 会把上游响应归类为安全的中文说明，并且不会返回上游原文、API Key、提示词或签名 URL：

| 返回码 | WorkBuddy 提示 | 建议操作 |
| --- | --- | --- |
| `content_policy_violation` | 此次生成因版权或内容安全限制被拒绝，请修改提示词或更换参考图后重试。 | 修改描述，避免受版权保护角色、品牌或敏感内容。 |
| `provider_insufficient_credits` | 图像服务余额或额度不足，请联系服务管理员检查账户余额或充值。 | 由服务管理员检查中转账户余额。 |
| `provider_rate_limited` | 图像服务当前请求过于频繁，请稍后再试。 | 稍后重新发起一条新的生成请求。 |
| `provider_auth_failed` | 图像服务的账户授权异常，请联系服务管理员检查服务端配置。 | 由管理员检查服务器 API Key；不要把 Key 发到聊天中。 |
| `provider_invalid_request` | 生成参数不符合图像服务要求，请检查提示词、比例、格式或参考图后重试。 | 调整输入后重新发起请求。 |
| `provider_unavailable` / `provider_unreachable` | 图像服务暂时不可用，请稍后再试。 | 等待后重新发起请求。 |
| `provider_error` | 图像服务返回了未识别的错误，请稍后重试；若持续出现请联系服务管理员。 | 保留发生时间并让管理员查看 gateway 脱敏日志。 |

这些错误都不会触发自动重试，避免被拒绝或已经提交的请求重复扣费。