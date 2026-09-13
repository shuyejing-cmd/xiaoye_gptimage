# WorkBuddy 图片生成 MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 构建可供 WorkBuddy 本地桥接器和远程 MCP 客户端调用的 GPT Image 2 服务：首版支持单张文生图和一张本地参考图生图。

**Architecture:** 已验证的 stdio 图片路径能力升级为本地 image-bridge，它只读取 WorkBuddy 给出的本机图片并以 HTTPS 调用腾讯云网关。网关鉴权、临时上传私有 COS、调用并轮询 APIMart；桥接 HTTP 与远程 Streamable HTTP MCP 共用同一个 generation service。

**Tech Stack:** Node.js 22.13+、ES modules、node:test、Zod、MCP SDK、Fastify、@fastify/multipart、node:sqlite、cos-nodejs-sdk-v5、Docker Compose、Caddy。

## Global Constraints

- 模型固定 gpt-image-2-official；APIMart Key 仅可在网关环境变量中出现。
- 首版固定 n: 1，只允许 1k 或 2k；提交第三方前拒绝 4k、透明背景、遮罩、多图和第二张参考图。
- 桥接器仅接收按魔数确认的 PNG/JPEG/WebP，单张上限 20 MiB；真实路径必须位于 ALLOWED_IMAGE_ROOTS 内。
- 本机路径绝不离开桥接器；网关只向 APIMart 传私有 COS 生成的短期 image_urls。
- 轮询间隔 2 秒、最多 90 秒；提交不重试，查询网络错误仅重试一次。
- SQLite 仅保存 request ID、task ID、状态、时间、最终 URL、错误类别，不保存 prompt、图片或密钥。
- /mcp 和 /v1/bridge/generations 必须使用同一个 bearer token；首版不含用户、OAuth、计费、配额和后台。

---

## File Structure

~~~text
package.json                              # 脚本、Node 版本、依赖
src/shared/contracts.mjs                  # Zod 参数契约、常量
src/shared/errors.mjs                     # 安全错误类型
src/bridge/image-file.mjs                 # 路径、大小、魔数验证
src/bridge/gateway-client.mjs             # HTTPS JSON/multipart 客户端
src/bridge/mcp-server.mjs                 # WorkBuddy stdio 工具
src/bridge/index.mjs                      # stdio 入口
src/gateway/config.mjs                    # 环境变量
src/gateway/auth.mjs                      # Bearer 校验
src/gateway/task-store.mjs                # SQLite 账本
src/gateway/cos-reference-store.mjs       # COS 上传、签名、删除
src/gateway/apimart-client.mjs            # 第三方提交和查询
src/gateway/generation-service.mjs        # 统一状态机
src/gateway/bridge-route.mjs              # bridge HTTP
src/gateway/remote-mcp-server.mjs         # Streamable HTTP MCP
src/gateway/app.mjs                       # Fastify 组装
src/gateway/index.mjs                     # 网关入口
test/{shared,bridge,gateway}/...          # 单元和集成测试
Dockerfile docker-compose.yml Caddyfile   # 部署
.env.example README.md                    # 配置和接入说明
~~~

### Task 1: 建立工程基线

**Files:**
- Modify: package.json
- Create: .gitignore, .env.example, README.md, test/project-layout.test.mjs

**Interfaces:**
- Produces: npm test、npm run bridge、npm run gateway、npm run test:unit。

- [ ] **Step 1: 初始化版本控制**

~~~powershell
git init
@'
node_modules/
.env
data/
coverage/
'@ | Set-Content -NoNewline .gitignore
~~~

- [ ] **Step 2: 写失败的工程约束测试**

~~~js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package declares Node 22.13+ and service scripts', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.engines.node, '>=22.13.0');
  assert.equal(pkg.scripts.bridge, 'node src/bridge/index.mjs');
  assert.equal(pkg.scripts.gateway, 'node src/gateway/index.mjs');
});
~~~

- [ ] **Step 3: 运行并确认失败**

Run: npm test -- --test-name-pattern="package declares"

Expected: FAIL，尚未声明 Node 和服务脚本。

- [ ] **Step 4: 写最小配置并安装依赖**

Add to package.json:

~~~json
{
  "engines": { "node": ">=22.13.0" },
  "scripts": {
    "test": "node --test",
    "test:unit": "node --test test",
    "bridge": "node src/bridge/index.mjs",
    "gateway": "node src/gateway/index.mjs"
  }
}
~~~

Install fastify, @fastify/multipart, cos-nodejs-sdk-v5; retain MCP SDK and Zod. Create .env.example with only APIMART_API_KEY, MCP_GATEWAY_TOKEN, COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION, COS_PREFIX, PORT, SQLITE_PATH, ALLOWED_IMAGE_ROOTS, IMAGE_GATEWAY_URL, IMAGE_GATEWAY_TOKEN.

- [ ] **Step 5: 验证并提交**

~~~powershell
npm test -- --test-name-pattern="package declares"
git add package.json package-lock.json .gitignore .env.example README.md test/project-layout.test.mjs
git commit -m "chore: scaffold image MCP services"
~~~

Expected: test PASS。

### Task 2: 定义参数契约与安全错误

**Files:**
- Create: src/shared/contracts.mjs, src/shared/errors.mjs, test/shared/contracts.test.mjs

**Interfaces:**
- Produces: parseGenerationRequest(input) -> { prompt, size, resolution, quality, output_format, n }，SUPPORTED_SIZES，AppError，toSafeErrorMessage(error)。

- [ ] **Step 1: 写参数边界失败测试**

~~~js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGenerationRequest } from '../../src/shared/contracts.mjs';

test('rejects 4k and n > 1', () => {
  assert.throws(() => parseGenerationRequest({ prompt: 'fox', resolution: '4k' }), /resolution/);
  assert.throws(() => parseGenerationRequest({ prompt: 'fox', n: 2 }), /n/);
});

test('applies first-version defaults', () => {
  assert.deepEqual(parseGenerationRequest({ prompt: 'fox' }), {
    prompt: 'fox', size: '1:1', resolution: '1k', quality: 'medium', output_format: 'png', n: 1
  });
});
~~~

- [ ] **Step 2: 验证失败**

Run: node --test test/shared/contracts.test.mjs

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 Zod 契约与错误对象**

~~~js
export const SUPPORTED_SIZES = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9'];
export function parseGenerationRequest(input) { /* return normalized schema output */ }
~~~

Schema requires a trimmed non-empty prompt, listed sizes, 1k or 2k, auto/low/medium/high, png/jpeg/webp, and literal n: 1. It rejects background, mask_url, image_urls, and output_compression. AppError has code, message, httpStatus, retryable; safe output never uses network or provider cause text.

- [ ] **Step 4: 扩展并运行测试**

Add blank prompt, invalid size, transparent background, second reference image and compression tests.

~~~powershell
node --test test/shared/contracts.test.mjs
~~~

Expected: PASS。

- [ ] **Step 5: 提交**

~~~powershell
git add src/shared test/shared
git commit -m "feat: define generation request contract"
~~~

### Task 3: 实现安全的本地参考图读取层

**Files:**
- Create: src/bridge/image-file.mjs, test/bridge/image-file.test.mjs
- Modify: src/inspect-image.mjs, test/inspect-image.test.mjs

**Interfaces:**
- Produces: readValidatedReferenceImage({ imagePath, allowedRoots }) -> Promise<{ buffer, mimeType, fileName }>。
- Guarantees: 不超过 20 MiB、真实路径在允许根目录、仅 PNG/JPEG/WebP。

- [ ] **Step 1: 写文件安全失败测试**

~~~js
await assert.rejects(
  () => readValidatedReferenceImage({ imagePath: outsideFile, allowedRoots: [allowedRoot] }),
  /允许的图片目录/
);
await assert.rejects(
  () => readValidatedReferenceImage({ imagePath: fakeJpeg, allowedRoots: [allowedRoot] }),
  /PNG、JPEG 或 WebP/
);
~~~

Use temporary directories; produce an oversized fixture with truncate(20 * 1024 * 1024 + 1). Add a symlink-escape test; skip only that subtest if Windows account permission prevents symlink creation.

- [ ] **Step 2: 验证失败**

Run: node --test test/bridge/image-file.test.mjs

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现真实路径和魔数检查**

~~~js
const roots = await Promise.all(allowedRoots.map((root) => realpath(root)));
const resolved = await realpath(imagePath);
if (!roots.some((root) => resolved === root || resolved.startsWith(root + sep))) throw new AppError(...);
const stat = await lstat(resolved);
if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new AppError(...);
const buffer = await readFile(resolved);
const mimeType = detectImageMime(buffer);
~~~

detectImageMime recognizes PNG, JPEG and RIFF....WEBP; all other bytes fail. The bridge never returns raw bytes or full local paths to the model.

- [ ] **Step 4: 验证回归**

~~~powershell
node --test test/bridge/image-file.test.mjs test/inspect-image.test.mjs
~~~

Expected: PASS；P0 的 JPEG MIME/字节数/SHA-256 检测不回退。

- [ ] **Step 5: 提交**

~~~powershell
git add src/bridge/image-file.mjs src/inspect-image.mjs test/bridge test/inspect-image.test.mjs
git commit -m "feat: validate local WorkBuddy reference images"
~~~

### Task 4: 实现 WorkBuddy stdio 桥接器

**Files:**
- Create: src/bridge/gateway-client.mjs, src/bridge/mcp-server.mjs, src/bridge/index.mjs
- Create: test/bridge/gateway-client.test.mjs, test/bridge/mcp-server.test.mjs
- Modify: test/stdio-entry.test.mjs

**Interfaces:**
- Produces: createGatewayClient({ baseUrl, token, fetchImpl }) with generateText(request) and generateWithReference(request, image)。
- Tool: generate_image({ prompt, reference_image_path?, size?, resolution?, quality?, output_format? })。

- [ ] **Step 1: 写 JSON、multipart 和 MCP 的失败测试**

~~~js
assert.equal(calls[0].url, 'https://gateway.example/v1/bridge/generations');
assert.equal(calls[0].headers.authorization, 'Bearer gateway-token');
assert.deepEqual(JSON.parse(calls[0].body), {
  prompt: 'fox', size: '1:1', resolution: '1k', quality: 'medium', output_format: 'png', n: 1
});
~~~

For image generation assert FormData has exactly request and image and does not contain reference_image_path. With InMemoryTransport, assert a valid fixture path calls generateWithReference.

- [ ] **Step 2: 验证失败**

Run: node --test test/bridge/gateway-client.test.mjs test/bridge/mcp-server.test.mjs

Expected: FAIL。

- [ ] **Step 3: 实现客户端和工具**

Text generation posts JSON; image generation posts multipart. Both use bearer auth and AbortSignal.timeout(100000); non-2xx responses use only controlled error.code and error.message.

Register the tool with this key description: “若本轮对话包含用户上传的参考图，请传入该附件的本机绝对路径；没有参考图时不要传入 reference_image_path。” Tool flow is Task 2 parse, then Task 3 validate, then client request. No upload occurs before validation.

- [ ] **Step 4: 验证 stdio**

Update the entry test to launch src/bridge/index.mjs, discover generate_image, and assert P0 probe_local_image is absent from production tools.

~~~powershell
node --test test/bridge/gateway-client.test.mjs test/bridge/mcp-server.test.mjs test/stdio-entry.test.mjs
~~~

Expected: PASS。

- [ ] **Step 5: 提交**

~~~powershell
git add src/bridge src/index.mjs src/mcp-server.mjs test/bridge test/stdio-entry.test.mjs
git commit -m "feat: add WorkBuddy image generation bridge"
~~~

### Task 5: 实现网关基础设施与统一异步状态机

**Files:**
- Create: src/gateway/config.mjs, src/gateway/auth.mjs, src/gateway/task-store.mjs
- Create: src/gateway/cos-reference-store.mjs, src/gateway/apimart-client.mjs, src/gateway/generation-service.mjs
- Create: test/gateway/auth.test.mjs, test/gateway/task-store.test.mjs, test/gateway/cos-reference-store.test.mjs, test/gateway/apimart-client.test.mjs, test/gateway/generation-service.test.mjs

**Interfaces:**
- loadConfig(env), requireBearerToken(expected), createTaskStore(path)。
- createReferenceStore(...).put({ buffer, mimeType, requestId }) -> { key, publicUrl }; remove(key)。
- createApimartClient(...).submit(request) -> { taskId }; getTask(taskId) -> { status, imageUrl?, expiresAt? }。
- createGenerationService(...).generate({ request, referenceImage? }) -> { requestId, status: 'completed', imageUrl, expiresAt? }。

- [ ] **Step 1: 写认证、账本、COS、APIMart 与状态机失败测试**

~~~js
assert.throws(() => loadConfig({}), /APIMART_API_KEY/);
await assert.rejects(() => requireBearerToken('x')({ headers: {} }), /未授权/);
assert.equal(submitCalls.length, 1);
assert.equal(result.imageUrl, 'https://upload.apimart.ai/f/image/result.png');
assert.deepEqual(referenceStore.removed, ['workbuddy-reference-images/req-1.jpg']);
~~~

Query PRAGMA table_info(generation_tasks) and reject column names matching prompt, image, token, secret or key. Assert APIMart submit body has fixed model, n: 1, and one image_urls COS URL. Test task ID from data[0].task_id, result URL from data.result.images[0].url[0], 429, failed status, one transient query failure and 90-second timeout; timeout must still have exactly one submission.

- [ ] **Step 2: 验证失败**

~~~powershell
node --test test/gateway/auth.test.mjs test/gateway/task-store.test.mjs test/gateway/cos-reference-store.test.mjs test/gateway/apimart-client.test.mjs test/gateway/generation-service.test.mjs
~~~

Expected: FAIL，gateway 模块均不存在。

- [ ] **Step 3: 实现配置、认证、最小账本和 provider 客户端**

Required env: APIMart key、gateway token 和 COS credential/bucket/region; defaults are port 3000, poll interval 2000 ms, timeout 90000 ms and data/tasks.sqlite. Bearer comparison uses timingSafeEqual only after matching lengths.

~~~sql
CREATE TABLE IF NOT EXISTS generation_tasks (
  request_id TEXT PRIMARY KEY, task_id TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, completed_at INTEGER, image_url TEXT, error_code TEXT
)
~~~

COS uploads are private, set ContentType/ContentLength, use a configured prefix plus request ID and safe extension, then create a 600-second signed URL. Submit has no retry. Query retries one network exception after 250 ms; malformed provider body maps to provider_protocol_error without echoing body.

- [ ] **Step 4: 实现生成状态机与终态清理**

~~~js
taskStore.create({ requestId, createdAt: now() });
const reference = referenceImage ? await referenceStore.put({ ...referenceImage, requestId }) : null;
const submitted = await apimartClient.submit({ ...request, reference_image_url: reference?.publicUrl });
taskStore.markSubmitted({ requestId, taskId: submitted.taskId });
// Poll every 2000 ms until completed, failed, or 90000 ms elapsed.
~~~

On completed, persist and return URL. On provider failure or timeout, persist generation_failed or generation_timeout. Use finally to delete a temporary COS object after every terminal outcome; deletion failure logs only fixed text and request ID and never replaces a success response.

- [ ] **Step 5: 验证并提交**

~~~powershell
node --test test/gateway
npm run test:unit
git add src/gateway/config.mjs src/gateway/auth.mjs src/gateway/task-store.mjs src/gateway/cos-reference-store.mjs src/gateway/apimart-client.mjs src/gateway/generation-service.mjs test/gateway
git commit -m "feat: orchestrate async image generation"
~~~

Expected: PASS；2 秒、90 秒、提交不重试及敏感信息边界有测试。

### Task 6: 暴露网关接口、部署并验收

**Files:**
- Create: src/gateway/bridge-route.mjs, src/gateway/remote-mcp-server.mjs, src/gateway/app.mjs, src/gateway/index.mjs
- Create: test/gateway/bridge-route.test.mjs, test/gateway/remote-mcp.test.mjs, test/deployment-files.test.mjs
- Create: Dockerfile, docker-compose.yml, Caddyfile
- Modify: .env.example, README.md

**Interfaces:**
- POST /v1/bridge/generations: JSON 文生图或 multipart request + 单 image。
- POST /mcp: authenticated Streamable HTTP MCP，只暴露文本生图 generate_image。
- GET /healthz: { status: 'ok' }。

- [ ] **Step 1: 写 HTTP、远程 MCP 与部署资产失败测试**

~~~js
const response = await app.inject({
  method: 'POST', url: '/v1/bridge/generations',
  headers: { authorization: 'Bearer gateway-token' }, payload: { prompt: 'fox' }
});
assert.equal(response.statusCode, 200);
assert.deepEqual(response.json(), {
  request_id: 'req-1', status: 'completed', image_url: 'https://result.example/a.png'
});
~~~

Test 401, two multipart image parts -> too_many_reference_images, invalid MIME, safe AppError mapping. Over a test HTTP server, list remote MCP tools and assert its schema does not include reference_image_path. Deployment test asserts Dockerfile uses node:22, Compose defines tasks-data, and no real secret pattern is committed.

- [ ] **Step 2: 验证失败**

~~~powershell
node --test test/gateway/bridge-route.test.mjs test/gateway/remote-mcp.test.mjs test/deployment-files.test.mjs
~~~

Expected: FAIL。

- [ ] **Step 3: 实现 Fastify 和 Streamable HTTP MCP**

Register multipart with { limits: { files: 1, fileSize: 20 * 1024 * 1024, parts: 8 } }; authenticate before body parse. JSON invokes service without reference; multipart validates one image with the same magic detector then invokes service with buffer, mimeType, fileName.

Use StreamableHTTPServerTransport and isInitializeRequest; create and retain transports by mcp-session-id, set enableJsonResponse true, and expose only the text-only tool. GET /mcp returns 405 with Allow: POST. AppError maps to error code/message; unknown errors map to HTTP 500 with exactly 服务暂时不可用，请稍后重试。

- [ ] **Step 4: 创建容器、反代和接入说明**

Dockerfile uses node:22-bookworm-slim, npm ci --omit=dev, writable /app/data, and gateway entrypoint. Compose injects .env, mounts tasks-data:/app/data, keeps gateway internal and lets only Caddy expose 80/443. Caddy proxies only /mcp, /v1/bridge/generations, /healthz.

README must include this WorkBuddy shape:

~~~json
{
  "mcpServers": {
    "image-bridge": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/path/to/image-mcp/src/bridge/index.mjs"],
      "env": {
        "ALLOWED_IMAGE_ROOTS": "C:/Users/NAME/Pictures",
        "IMAGE_GATEWAY_URL": "https://image.example.com",
        "IMAGE_GATEWAY_TOKEN": "replace-with-token"
      }
    }
  }
}
~~~

Document Cursor/Claude https://<domain>/mcp bearer config, a real DNS domain before Caddy TLS, private COS bucket, and lifecycle deletion of workbuddy-reference-images/ after one day.

- [ ] **Step 5: 自动验证、真实端到端验收并提交**

~~~powershell
node --test test/gateway/bridge-route.test.mjs test/gateway/remote-mcp.test.mjs test/deployment-files.test.mjs
npm test
docker compose config
docker build -t workbuddy-image-gateway:local .
~~~

Expected: all PASS; Compose has tasks-data and displays no real key.

Then create untracked .env using a new gateway token, least-privilege COS credential and APIMart key. Set COS private and lifecycle first. Deploy docker compose up -d --build, verify https://<domain>/healthz, then:

1. WorkBuddy 1k 文生图返回可打开 URL；
2. WorkBuddy 上传 JPEG 并传附件绝对路径，返回可打开 URL 且 COS 临时对象被删；
3. Cursor/Claude 连接远程 MCP，文本生图返回 URL，工具没有本地路径参数；
4. 4k、非图片路径和 20 MiB+ 文件都在 APIMart 提交前失败；
5. SQLite 与日志不含 prompt、图片、APIMart/COS/gateway 密钥。

Add a dated README 验证记录, redact domain as <domain> and provider task as <task-id>, then:

~~~powershell
git add Dockerfile docker-compose.yml Caddyfile .env.example README.md src/gateway/bridge-route.mjs src/gateway/remote-mcp-server.mjs src/gateway/app.mjs src/gateway/index.mjs test/gateway test/deployment-files.test.mjs
git commit -m "feat: deploy image MCP gateway"
~~~

## Self-Review

### Spec coverage

- WorkBuddy 本地 stdio、附件绝对路径、安全文件读取：Task 3–4。
- 腾讯云网关、私有 COS 短期 URL、APIMart 异步提交/轮询：Task 5–6。
- 单图、1k/2k、禁用 4k/多图/透明/遮罩：Task 2、4、6。
- 单一 bearer、最小 SQLite 元数据：Task 5–6。
- 远程 Streamable HTTP MCP 文生图：Task 6。
- Docker、Caddy HTTPS、COS 生命周期及各客户端配置：Task 6。
- 单元、集成、真实端到端验证：每个任务的 TDD 循环与 Task 6 收尾。

### Placeholder scan

已检查：没有 TBD、TODO、后续实现或适当处理错误等占位语；每个任务都给出文件、接口、失败测试、命令和可观察结果。

### Type consistency

- 所有入口先取得 Task 2 的规范化对象：{ prompt, size, resolution, quality, output_format, n }。
- 参考图始终是 { buffer, mimeType, fileName }，COS 映射为 { key, publicUrl }。
- service 返回 { requestId, status, imageUrl, expiresAt? }，HTTP/MCP 只转换为 snake_case。
