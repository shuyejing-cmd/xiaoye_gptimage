# WorkBuddy Prompt-Guided Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user copy one short installation prompt into WorkBuddy, authorize one local action, and receive an automatically discovered, validated `xiaoye-image` MCP installation without exposing the long-lived API Key in chat or command-line arguments.

**Architecture:** The website creates a short-lived, single-use installation token tied to the current session and one active API Key. A signed PowerShell bootstrap passes that token to the existing Windows installer through a protected temporary file; the installer exchanges it for the API Key, discovers the real WorkBuddy configuration path, merges only `xiaoye-image`, and verifies the gateway and local MCP entry before reporting success.

**Tech Stack:** Node.js 22, Fastify, PostgreSQL, React/Vite, Node test runner, PowerShell 5.1+, Inno Setup 6, Authenticode.

---

### Task 1: Installation Token Persistence and Service

**Files:**
- Modify: `src/platform/db/migrations.mjs`
- Modify: `src/platform/config.mjs`
- Modify: `.env.example`
- Modify: `src/platform/auth/api-key-service.mjs`
- Create: `src/platform/installations/installation-token-service.mjs`
- Test: `test/platform/migrations.test.mjs`
- Test: `test/platform/platform-config.test.mjs`
- Create: `test/platform/installation-token-service.test.mjs`

- [x] **Step 1: Write the failing migration and configuration tests**

Extend the migration assertion to expect schema version 6 and this table shape:

```sql
create table installation_tokens (
  id bigserial primary key,
  user_id bigint not null references users(id),
  api_key_id bigint not null references api_keys(id),
  session_id text not null references sessions(id),
  token_prefix text not null unique,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
)
```

Add `INSTALLATION_TOKEN_PEPPER` to the complete configuration fixture and assert that missing it raises `missing_config`.
Also expose `publicOrigin` from `PUBLIC_ORIGIN` (default `https://xiaoyeai.cn`) and `installerVersion` from `WORKBUDDY_INSTALLER_VERSION` (default `1.1.0`), rejecting a non-HTTPS production origin or a version outside `major.minor.patch` format.

- [x] **Step 2: Write failing service tests for lifecycle and concurrency**

Create fixtures with one active user, website session, wallet, and encrypted API Key. Cover:

```js
const created = await service.create({ userId, sessionId, apiKeyId });
assert.match(created.token, /^wb_install_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]+$/);
assert.equal(JSON.stringify(await pool.query("select * from installation_tokens")).includes(created.token), false);

const results = await Promise.allSettled(
  Array.from({ length: 20 }, () => service.exchange(created.token))
);
assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(results.find((result) => result.status === "fulfilled").value.apiKey, key.key);
```

Also assert `installation_token_expired`, `installation_token_used`, `api_key_invalid`, and `invalid_session` for an expired token, a second exchange, a revoked target Key, a revoked creating session, and a suspended account. Assert that a sixth unexpired token returns `installation_token_limit_reached`.

- [x] **Step 3: Run the new tests and confirm RED**

Run:

```powershell
node --test --test-isolation=none test/platform/migrations.test.mjs test/platform/platform-config.test.mjs test/platform/installation-token-service.test.mjs
```

Expected: FAIL because migration 6, `INSTALLATION_TOKEN_PEPPER`, and the service do not exist.

- [x] **Step 4: Add migration 6 and the independent pepper**

Add the table above plus:

```sql
create index installation_tokens_active_user_idx
on installation_tokens(user_id, expires_at)
where consumed_at is null
```

Require and expose `installationTokenPepper` from `INSTALLATION_TOKEN_PEPPER`. Document it as a different random secret from `AUTH_PEPPER` and `API_KEY_PEPPER`. Add these example values:

```dotenv
INSTALLATION_TOKEN_PEPPER=replace-with-an-independent-random-secret
PUBLIC_ORIGIN=https://xiaoyeai.cn
WORKBUDDY_INSTALLER_VERSION=1.1.0
```

- [x] **Step 5: Add an API-key resolver for the installation transaction**

Expose a method on `createApiKeyService` that can use an existing PostgreSQL client:

```js
async resolveActiveForInstallation({ userId, keyId, client = pool }) {
  const result = await client.query(
    "select * from api_keys where id=$1 and user_id=$2 and status='active'",
    [keyId, userId]
  );
  const key = result.rows[0] && revealedKey(result.rows[0], cipher);
  if (!key) throw new AppError({ code: "api_key_invalid", message: "个人 Key 已撤销或无法读取", httpStatus: 401 });
  return key;
}
```

- [x] **Step 6: Implement the installation-token service**

Use HMAC-SHA256 with `installationTokenPepper`, 24 random bytes encoded as Base64URL, a 10-minute TTL, row locking during exchange, and the existing `withTransaction` helper. The public interface must be:

```js
createInstallationTokenService({ pool, pepper, apiKeyService, now, randomBytes })
// .create({ userId, sessionId, apiKeyId })
//   -> { token, expiresAt }
// .exchange(rawToken)
//   -> { apiKey, apiKeyId, userId }
```

`create` must verify the session belongs to the user and is active, verify the Key belongs to the user and is active, reject when five unconsumed/unexpired rows exist, and insert `create_installation_token` in `audit_events`.

`exchange` must select the matching token row `for update`, validate expiry and `consumed_at`, join and validate the creating session, user, and API Key, set `consumed_at` before commit, and insert `exchange_installation_token` in `audit_events`. No error or audit metadata may include either token or API Key.

- [x] **Step 7: Run focused tests and commit**

Run the Step 3 command. Expected: all tests PASS.

```powershell
git add .env.example src/platform/db/migrations.mjs src/platform/config.mjs src/platform/auth/api-key-service.mjs src/platform/installations/installation-token-service.mjs test/platform/migrations.test.mjs test/platform/platform-config.test.mjs test/platform/installation-token-service.test.mjs
git commit -m "feat: add single-use installation tokens"
```

### Task 2: Prompt and Exchange HTTP APIs

**Files:**
- Create: `src/platform/installations/install-prompt.mjs`
- Modify: `src/platform/runtime.mjs`
- Modify: `src/platform/http/platform-app.mjs`
- Modify: `src/platform/index.mjs`
- Modify: `test/platform/platform-app.test.mjs`
- Create: `test/platform/install-prompt.test.mjs`

- [x] **Step 1: Write failing prompt-format tests**

Define the exact formatter contract:

```js
const prompt = buildWorkBuddyInstallPrompt({
  installationToken: "wb_install_public_secret",
  version: "1.1.0",
  origin: "https://xiaoyeai.cn"
});
assert.match(prompt, /wb_install_public_secret/);
assert.match(prompt, /https:\/\/xiaoyeai\.cn\/install\/workbuddy-image-mcp\.ps1/);
assert.match(prompt, /执行前.*确认/);
assert.doesNotMatch(prompt, /wb_live_/);
```

The text must tell WorkBuddy to create a current-user-only temporary token file, download the fixed bootstrap version, run it with `-TokenFile`, show its result unchanged, and fall back to `/downloads/WorkBuddy-Image-MCP-Setup.exe` when local command execution is unavailable.

- [x] **Step 2: Write failing API tests**

Extend the platform fixture with the token service. Assert:

```text
POST /api/api-keys/:id/installation-token
  unauthenticated -> 401
  another user's key -> 401 api_key_invalid
  owner -> 201 { prompt, expires_at }
  response Cache-Control -> no-store
  prompt contains wb_install_ and never contains wb_live_

POST /v1/installations/exchange
  valid token -> 200 { api_key, gateway_url }
  response Cache-Control -> no-store
  second exchange -> 409 installation_token_used
```

Call the first endpoint four times inside one minute and assert the fourth is `429 rate_limited`; network retry is not automatically repeated because each successful creation deliberately creates a new installation code.

- [x] **Step 3: Run the focused tests and confirm RED**

```powershell
node --test --test-isolation=none test/platform/install-prompt.test.mjs test/platform/platform-app.test.mjs
```

Expected: FAIL with missing formatter and routes.

- [x] **Step 4: Implement the prompt formatter and routes**

Keep `install-prompt.mjs` pure. Add `installationTokenService` to the runtime and platform app dependencies. The website route must authenticate once and retain both values returned by `authService.authenticateSession`:

```js
const session = await websiteSession(request);
await rateLimiter.consume({ scope: "installation_token", subject: String(session.user.id), limit: 3, windowMs: 60_000 });
const issued = await installationTokenService.create({
  userId: session.user.id,
  sessionId: session.sessionId,
  apiKeyId: request.params.id
});
reply.header("Cache-Control", "no-store");
return reply.code(201).send({
  prompt: buildWorkBuddyInstallPrompt({ installationToken: issued.token, version: installerVersion, origin: publicOrigin }),
  expires_at: issued.expiresAt
});
```

Pass `publicOrigin` and `installerVersion` from `src/platform/config.mjs` through `src/platform/index.mjs` into `createPlatformApp`. The exchange route accepts `{ installation_token }`, never accepts a Key ID, and returns `{ api_key, gateway_url: publicOrigin }` only after the token service transaction commits.

- [x] **Step 5: Verify logout invalidation and safe logging**

Create a token, call `/api/auth/logout`, and assert exchange returns `invalid_session`. Capture Fastify logs for invalid exchange and assert they contain neither `wb_install_` nor `wb_live_`.

- [x] **Step 6: Run tests and commit**

Run the Step 3 command plus `test/platform/auth-service.test.mjs`. Expected: PASS.

```powershell
git add src/platform/installations/install-prompt.mjs src/platform/runtime.mjs src/platform/http/platform-app.mjs src/platform/index.mjs test/platform/install-prompt.test.mjs test/platform/platform-app.test.mjs
git commit -m "feat: expose prompt-guided installation API"
```

### Task 3: Website Primary Installation Flow

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/enhancements.css`
- Modify: `web/src/mcp-config.js`
- Modify: `test/web/mcp-config.test.mjs`

- [ ] **Step 1: Add failing pure UI-state tests**

Extend `mcp-config.js` with small pure helpers and test:

```js
assert.equal(installationPromptStatus({ copied: true }), "安装提示词已复制，请粘贴给 WorkBuddy");
assert.equal(formatInstallExpiry(new Date("2026-09-15T12:10:00Z"), "zh-CN").includes("12:10"), true);
```

Do not duplicate the prompt formatter in the frontend; the API response is the sole prompt text.

- [ ] **Step 2: Run the web unit test and confirm RED**

```powershell
node --test --test-isolation=none test/web/mcp-config.test.mjs
```

Expected: FAIL because the helpers are missing.

- [ ] **Step 3: Implement the Key-page primary action**

For every recoverable active Key, render actions in this order:

```text
复制安装提示词   (primary)
下载安装器
复制完整配置
复制 Key
```

On click, POST `/api/api-keys/${key.id}/installation-token`, copy `response.prompt`, and show an `aria-live` confirmation with the exact expiration time. Disable only that Key's issue button while the request is pending. On clipboard failure, show the prompt in a selectable `<pre>` rather than creating a second token.

- [ ] **Step 4: Simplify the Install page**

Replace the four-step default flow with:

```text
01 创建个人 Key
02 复制安装提示词并粘贴给 WorkBuddy
03 允许执行，然后开启 xiaoye-image
```

Keep the signed installer and complete JSON under a clearly labeled manual fallback section. Do not remove direct Key display or revocation.

- [ ] **Step 5: Add responsive and accessible states**

Reuse the existing flat ledger design. Ensure the prompt feedback is visible at 390px, buttons remain at least 42px high, keyboard focus is visible, expiration does not rely on color, and no Key or installation token is written to `localStorage`, URL state, analytics, or console.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
node --test --test-isolation=none test/web/mcp-config.test.mjs
npm run build
node C:\Users\Midiec\Documents\Codex\.agents\skills\impeccable\scripts\detect.mjs --json web/src/App.jsx web/src/enhancements.css
```

Inspect the Key page once at desktop width and 390px. Expected: primary action is visible without horizontal overflow, and fallback controls remain usable.

```powershell
git add web/src/App.jsx web/src/enhancements.css web/src/mcp-config.js test/web/mcp-config.test.mjs
git commit -m "feat: make prompt installation the primary website flow"
```

### Task 4: Installer Token Exchange and Configuration Discovery

**Files:**
- Create: `installer/config-discovery.mjs`
- Create: `installer/installation-client.mjs`
- Modify: `installer/config-cli.mjs`
- Modify: `installer/config-manager.mjs`
- Modify: `installer/workbuddy-image-mcp.iss`
- Modify: `installer/repair-config.ps1`
- Modify: `test/platform/installer-config.test.mjs`
- Create: `test/platform/installer-installation-client.test.mjs`

- [ ] **Step 1: Write failing configuration-discovery tests**

Use temporary Windows-style directory fixtures and injected `exists`/environment dependencies. Assert priority:

```text
explicit --config
%USERPROFILE%/.workbuddy/mcp.json
one discovered WorkBuddy candidate
ambiguous candidates -> workbuddy_config_ambiguous
no candidate -> workbuddy_config_not_found
```

Never select a path merely because it is beside an unrelated running process. A discovered candidate must either contain a valid `mcpServers` object or be the documented default path.

- [ ] **Step 2: Write failing exchange-client tests**

`exchangeInstallationToken({ gatewayUrl, tokenFile, fetchImpl })` must:

- read and trim the token from `tokenFile`;
- POST it in a JSON body to `/v1/installations/exchange`;
- unlink the token file in `finally` for both success and failure;
- return `{ apiKey, gatewayUrl }` on 200;
- map safe server codes without including the token or response body in errors;
- reject a token file not owned by the current user when Windows ACL inspection fails.

- [ ] **Step 3: Run installer tests and confirm RED**

```powershell
node --test --test-isolation=none test/platform/installer-config.test.mjs test/platform/installer-installation-client.test.mjs
```

Expected: FAIL with missing discovery and exchange modules.

- [ ] **Step 4: Implement discovery and exchange**

Keep discovery pure except for injected filesystem probes. Add a `promptForConfigPath` result to the CLI rather than silently choosing among multiple candidates. Make `config-cli.mjs install-token` accept only:

```text
--gateway=https://xiaoyeai.cn
--token-file=<protected local path>
--install-dir=<actual Inno {app}>
--roots=<local image roots>
[--config=<explicit path>]
```

Do not retain `--key` on the automated flow. The existing `install` and `repair` modes may keep `--key-file` for manual fallback.

- [ ] **Step 5: Strengthen post-write self-diagnosis**

After merging the config, verify all of the following before returning `installed`:

```js
checks.json === true
checks.entry === true
checks.command === true // node.exe exists
checks.bridge === true  // src/index.mjs exists
checks.key === true
checks.gateway === true
```

If a post-write check fails, restore the timestamped backup. Preserve the recovered Key in a user-only file under the install directory so `repair` can finish without another token; delete it after a successful repair.

- [ ] **Step 6: Modify Inno Setup for token and manual modes**

Add silent parameters `/TOKENFILE=`, `/CONFIG=`, and `/ROOTS=`. When `/TOKENFILE` is present, skip the Key wizard page, default roots to `{userpictures}`, and invoke `config-cli.mjs install-token`. Without it, preserve the existing manual Key page.

Ensure Inno never expands or logs file contents and deletes the token file even when installation fails. Map CLI exit codes to the stable Chinese error messages in the design.

- [ ] **Step 7: Run installer tests and commit**

Run the Step 3 command and `test/project-layout.test.mjs`. Expected: PASS.

```powershell
git add installer/config-discovery.mjs installer/installation-client.mjs installer/config-cli.mjs installer/config-manager.mjs installer/workbuddy-image-mcp.iss installer/repair-config.ps1 test/platform/installer-config.test.mjs test/platform/installer-installation-client.test.mjs
git commit -m "feat: install WorkBuddy MCP from one-time token"
```

### Task 5: Signed Bootstrap and Release Manifest

**Files:**
- Create: `installer/workbuddy-image-mcp-bootstrap.ps1`
- Create: `installer/release-manifest.mjs`
- Modify: `installer/build-installer.ps1`
- Create: `test/platform/installer-release.test.mjs`

- [ ] **Step 1: Write failing manifest and bootstrap contract tests**

Test a pure manifest builder:

```js
assert.deepEqual(buildReleaseManifest({ version, sha256, publisher, installerUrl }), {
  version,
  sha256,
  publisher,
  installer_url: installerUrl
});
```

Read the bootstrap as text and assert it requires HTTPS URLs, downloads the manifest before the executable, compares SHA-256 using `Get-FileHash`, validates Authenticode status and exact publisher, passes `/TOKENFILE=`, and removes downloaded/token temporary files in `finally`. Assert it contains no `Invoke-Expression` and no execution-policy bypass.

- [ ] **Step 2: Run the release test and confirm RED**

```powershell
node --test --test-isolation=none test/platform/installer-release.test.mjs
```

Expected: FAIL because manifest builder and bootstrap are missing.

- [ ] **Step 3: Implement the bootstrap**

Accept only:

```powershell
param(
  [Parameter(Mandatory=$true)][string]$TokenFile,
  [string]$ManifestUrl = 'https://xiaoyeai.cn/install/workbuddy-image-mcp-1.1.0.json'
)
```

Resolve and validate the token file inside the current user's temp directory, require TLS 1.2+, reject redirects to non-HTTPS URLs, validate manifest fields, compare SHA-256 in constant textual form, require `Get-AuthenticodeSignature(...).Status -eq 'Valid'`, compare the signer subject against the fixed publisher, start the installer with `/VERYSILENT /TOKENFILE="..."`, wait for its exit code, and clean temporary files in `finally`.

- [ ] **Step 4: Publish a versioned manifest only after signing**

Update `build-installer.ps1` so the signed branch performs this order:

```text
build -> Authenticode sign -> signature verify -> SHA-256 -> manifest JSON
-> copy versioned installer, manifest, and bootstrap to web/public/install
-> update stable download copy
```

The unsigned branch may build a local test executable but must not write anything under `web/public/install` or `web/public/downloads`.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```powershell
git add installer/workbuddy-image-mcp-bootstrap.ps1 installer/release-manifest.mjs installer/build-installer.ps1 test/platform/installer-release.test.mjs
git commit -m "feat: publish verified WorkBuddy installer bootstrap"
```

### Task 6: End-to-End Integration, Documentation, and Release Gates

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/production-launch-checklist.md`
- Create: `test/platform/prompt-install-flow.test.mjs`
- Modify: `docs/superpowers/plans/2026-09-15-workbuddy-prompt-guided-installer.md`

- [ ] **Step 1: Write the end-to-end API/install-flow test**

Use PostgreSQL-memory services and temporary files to execute this sequence without a real external provider:

```text
login -> create Key -> issue prompt -> extract installation token
-> write protected token file -> exchange -> discover config
-> merge xiaoye-image -> diagnose gateway -> verify other MCP unchanged
-> verify token file deleted -> second exchange rejected
```

Assert the generated prompt, subprocess argument list, config backups, errors, and captured logs contain no `wb_live_` Key.

- [ ] **Step 2: Run the E2E test and confirm it passes after integration**

```powershell
node --test --test-isolation=none test/platform/prompt-install-flow.test.mjs
```

Expected: PASS. If it fails, change production units rather than weakening the assertions.

- [ ] **Step 3: Update user and operator documentation**

Document the three-step prompt flow first, then the installer and JSON fallbacks. Add production requirements for `INSTALLATION_TOKEN_PEPPER`, a signed 1.1.0 installer, exact publisher verification, stable/versioned install URLs, and WorkBuddy command-execution permission.

Add launch checklist items for one successful prompt-guided install, expired/used token behavior, disabled WorkBuddy shell capability fallback, Windows 10/11 clean-user verification, and confirmation that long-lived Keys do not appear in prompt or logs.

- [ ] **Step 4: Run complete verification**

```powershell
npm test
npm run build
git diff --check
```

Expected: all runnable tests PASS; the existing symlink test may skip on Windows when the current user cannot create symlinks. Build must exit 0 and diff check must report no errors.

- [ ] **Step 5: Run local PostgreSQL smoke verification**

Restart the API and worker with migration 6, then verify without printing secrets:

```text
/readyz -> 200
issue installation prompt -> 201
exchange installation token -> 200
balance with exchanged Key -> 200
second exchange -> 409 installation_token_used
database contains only token_hash, never raw installation token
```

- [ ] **Step 6: Run bounded Windows installer acceptance**

On a test machine or clean Windows user profile:

```text
no Node.js installed
existing WorkBuddy config containing at least two unrelated MCP entries
custom installation directory
default and explicitly selected mcp.json locations
WorkBuddy command execution allowed and denied
```

Expected: allowed path installs and diagnoses successfully; denied path shows the manual installer fallback; unrelated MCP entries remain deeply equal after parsing; uninstall removes only `xiaoye-image`.

- [ ] **Step 7: Mark this plan complete and commit**

Only check completed items after their evidence exists.

```powershell
git add README.md docs/operations/production-launch-checklist.md test/platform/prompt-install-flow.test.mjs docs/superpowers/plans/2026-09-15-workbuddy-prompt-guided-installer.md
git commit -m "docs: finish prompt-guided installer rollout"
```
