# WorkBuddy COS-First Installer Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish WorkBuddy Image MCP 1.2.1 through Tencent COS as the primary China-friendly download source, retain GitHub as fallback, and make the prompt-guided Windows install succeed under Restricted execution policy and inherited Temp ACLs.

**Architecture:** The commercial API builds an installation prompt from a verified release descriptor containing COS primary URLs and GitHub fallback URLs. A dedicated release verifier fetches the small public manifest/bootstrap and uses authenticated COS object metadata for the EXE size and SHA-256, so it never downloads the full installer. The Windows bootstrap normalizes its private working directory, retries COS, falls back to GitHub, validates SHA-256, installs atomically, and always cleans up.

**Tech Stack:** Node.js 22, Fastify, `cos-nodejs-sdk-v5`, PowerShell 5.1+, Inno Setup, GitHub Actions, Tencent COS, Node test runner.

---

## File map

- `src/platform/config.mjs`: validate COS release configuration and expose version `1.2.1`.
- `src/platform/runtime.mjs`: construct the COS release metadata adapter and release verifier.
- `src/platform/installations/cos-release-store.mjs`: read EXE size and SHA-256 metadata from COS without downloading it.
- `src/platform/installations/release-service.mjs`: verify COS primary assets and return GitHub fallback URLs.
- `src/platform/installations/install-prompt.mjs`: generate the tested one-authorization installation instructions.
- `installer/release-manifest.mjs`: produce the 1.2.1 manifest with primary and fallback installer URLs.
- `installer/build-installer.ps1`: stage 1.2.1 artifacts and COS metadata.
- `installer/workbuddy-image-mcp-bootstrap.ps1`: ACL normalization, retry/fallback download, Bypass-compatible execution, cleanup, and error mapping.
- `installer/workbuddy-image-mcp.iss`: set the installer version to `1.2.1`.
- `.github/workflows/release.yml`: build once, publish GitHub Release, then publish COS with manifest last.
- `web/src/main.jsx`: describe Tencent primary download and GitHub fallback without exposing implementation details.
- `.env.example`, `README.md`, `docs/operations/production-launch-checklist.md`: production configuration and operator evidence.
- `test/platform/*.test.mjs`: release, prompt, bootstrap, configuration, and end-to-end contract tests.

### Task 1: Lock the 1.2.1 configuration contract

**Files:**
- Modify: `test/platform/platform-config.test.mjs`
- Modify: `src/platform/config.mjs`
- Modify: `.env.example`

- [ ] **Step 1: Write failing configuration tests**

Add assertions that the default version is `1.2.1`, and production release configuration requires a primary HTTPS base URL plus COS bucket and region:

```js
const releaseEnv = {
  ...baseEnv,
  WORKBUDDY_INSTALLER_VERSION: "1.2.1",
  WORKBUDDY_RELEASE_BASE_URL: "https://download.xiaoyeai.cn",
  WORKBUDDY_RELEASE_COS_BUCKET: "workbuddy-release-1250000000",
  WORKBUDDY_RELEASE_COS_REGION: "ap-shanghai",
  WORKBUDDY_RELEASE_REPOSITORY: "shuyejing-cmd/xiaoye_gptimage"
};

const config = loadPlatformConfig(releaseEnv);
assert.equal(config.installerVersion, "1.2.1");
assert.deepEqual(config.releaseCos, {
  bucket: "workbuddy-release-1250000000",
  region: "ap-shanghai",
  baseUrl: "https://download.xiaoyeai.cn"
});
assert.throws(
  () => loadPlatformConfig({ ...releaseEnv, WORKBUDDY_RELEASE_BASE_URL: "http://download.xiaoyeai.cn" }),
  (error) => error.code === "invalid_config"
);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```text
node --test test/platform/platform-config.test.mjs
```

Expected: FAIL because `installerVersion` is still `1.2.0` and `releaseCos` is absent.

- [ ] **Step 3: Implement the configuration fields**

In `loadPlatformConfig`, validate `WORKBUDDY_RELEASE_BASE_URL` with `new URL()`, require HTTPS, reject credentials/query/hash, and return:

```js
releaseCos: {
  bucket: String(env.WORKBUDDY_RELEASE_COS_BUCKET || "").trim() || null,
  region: String(env.WORKBUDDY_RELEASE_COS_REGION || "").trim() || null,
  baseUrl: releaseBaseUrl ? releaseBaseUrl.replace(/\/+$/, "") : null
}
```

Set the default installer version to `1.2.1`. Add these documented keys to `.env.example`:

```dotenv
WORKBUDDY_INSTALLER_VERSION=1.2.1
WORKBUDDY_RELEASE_BASE_URL=https://download.xiaoyeai.cn
WORKBUDDY_RELEASE_COS_BUCKET=
WORKBUDDY_RELEASE_COS_REGION=ap-shanghai
WORKBUDDY_RELEASE_REPOSITORY=shuyejing-cmd/xiaoye_gptimage
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run `node --test test/platform/platform-config.test.mjs`.

Expected: all configuration tests PASS.

- [ ] **Step 5: Commit**

```text
git add src/platform/config.mjs test/platform/platform-config.test.mjs .env.example
git commit -m "feat: configure COS installer releases"
```

### Task 2: Extend the manifest and versioned installer build

**Files:**
- Modify: `test/platform/installer-release.test.mjs`
- Modify: `installer/release-manifest.mjs`
- Modify: `installer/build-installer.ps1`
- Modify: `installer/workbuddy-image-mcp.iss`
- Modify: `installer/workbuddy-image-mcp-bootstrap.ps1`

- [ ] **Step 1: Write failing 1.2.1 manifest tests**

Add this contract:

```js
const manifest = buildReleaseManifest({
  version: "1.2.1",
  sha256: "a".repeat(64),
  signed: false,
  installerUrl: "https://download.xiaoyeai.cn/releases/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe",
  fallbackInstallerUrls: [
    "https://github.com/shuyejing-cmd/xiaoye_gptimage/releases/download/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe"
  ]
});

assert.equal(manifest.version, "1.2.1");
assert.deepEqual(manifest.fallback_installer_urls, [
  "https://github.com/shuyejing-cmd/xiaoye_gptimage/releases/download/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe"
]);
assert.throws(
  () => buildReleaseManifest({ ...validInput, fallbackInstallerUrls: ["http://example.com/setup.exe"] }),
  /HTTPS/
);
```

Also assert that the PowerShell and Inno sources all contain `1.2.1`, and no current release file still declares `1.2.0`.

- [ ] **Step 2: Run and verify RED**

Run `node --test test/platform/installer-release.test.mjs`.

Expected: FAIL on missing `fallback_installer_urls` and old version strings.

- [ ] **Step 3: Implement the manifest fields**

Return this stable object from `buildReleaseManifest`:

```js
return {
  version,
  sha256: normalizedSha256,
  channel: "beta",
  signed: Boolean(signed),
  installer_url: installer.href,
  fallback_installer_urls: fallbackInstallerUrls.map((value) => requireHttps(value).href),
  ...(signed ? { publisher } : {})
};
```

Update the build script to require:

```powershell
$PrimaryBaseUrl = $env:WORKBUDDY_RELEASE_BASE_URL.TrimEnd('/')
$Repository = $env:WORKBUDDY_RELEASE_REPOSITORY
$InstallerUrl = "$PrimaryBaseUrl/releases/v$Version/WorkBuddy-Image-MCP-Setup-$Version.exe"
$FallbackInstallerUrl = "https://github.com/$Repository/releases/download/v$Version/WorkBuddy-Image-MCP-Setup-$Version.exe"
```

Pass both URLs to the manifest generator, set `$Version = '1.2.1'`, set `AppVersion=1.2.1`, and set `$ExpectedVersion = '1.2.1'` in bootstrap.

- [ ] **Step 4: Verify GREEN**

Run `node --test test/platform/installer-release.test.mjs`.

Expected: all installer release tests PASS.

- [ ] **Step 5: Commit**

```text
git add installer test/platform/installer-release.test.mjs
git commit -m "feat: define WorkBuddy installer 1.2.1 manifest"
```

### Task 3: Make the Windows bootstrap resilient

**Files:**
- Modify: `test/platform/installer-release.test.mjs`
- Modify: `test/platform/installer-installation-client.test.mjs`
- Modify: `installer/workbuddy-image-mcp-bootstrap.ps1`
- Modify: `installer/installation-client.mjs`

- [ ] **Step 1: Add failing source-contract tests**

Require all of these behaviors:

```js
assert.match(bootstrap, /fallback_installer_urls/);
assert.match(bootstrap, /MaxAttempts\s*=\s*3/);
assert.match(bootstrap, /TimeoutSec/);
assert.match(bootstrap, /icacls\.exe/);
assert.match(bootstrap, /inheritance:r/i);
assert.match(bootstrap, /finally/);
assert.match(promptCommand, /ExecutionPolicy Bypass/);
```

Extend the Windows ACL test so a new token file initially inherits an extra read rule, then `restrictPrivateFile()` removes it and `verifyPrivateTokenFile()` returns true.

- [ ] **Step 2: Run and verify RED**

Run:

```text
node --test test/platform/installer-release.test.mjs test/platform/installer-installation-client.test.mjs
```

Expected: FAIL because retry/fallback and ACL normalization are missing.

- [ ] **Step 3: Add a retrying download helper**

Add this behavior to bootstrap, preserving the existing cleanup `finally` block:

```powershell
function Invoke-DownloadWithRetry {
  param(
    [string[]]$Urls,
    [string]$Destination,
    [int]$MaxAttempts = 3
  )
  foreach ($Url in $Urls) {
    Assert-HttpsUrl $Url 'download URL' | Out-Null
    for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
      try {
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 120
        if ((Get-Item -LiteralPath $Destination).Length -gt 0) { return $Url }
      } catch {
        if ($Attempt -eq $MaxAttempts) { break }
        Start-Sleep -Seconds ([Math]::Min(2 * $Attempt, 5))
      }
    }
  }
  throw 'installer_download_failed'
}
```

Build the installer URL list from `installer_url` followed by `fallback_installer_urls`. After any successful download, retain the existing minimum size and SHA-256 checks before `Start-Process`.

- [ ] **Step 4: Normalize the token ACL before reading**

In both the bootstrap and Node installer client, apply inheritance removal and explicit current-user/SYSTEM/Administrators permissions before verification. Resolve the current user by SID instead of localized username:

```powershell
$Me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $FullPath /inheritance:r /grant:r `
  "*$Me`:(R,W)" `
  '*S-1-5-18:(F)' `
  '*S-1-5-32-544:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'installation_token_file_insecure' }
```

Then read the ACL again and reject any other Allow rule. Continue deleting the token file in `finally` even when normalization fails.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```text
node --test test/platform/installer-release.test.mjs test/platform/installer-installation-client.test.mjs
```

Expected: all tests PASS; the ACL test may skip only when Windows denies test ACL manipulation.

- [ ] **Step 6: Commit**

```text
git add installer test/platform/installer-release.test.mjs test/platform/installer-installation-client.test.mjs
git commit -m "fix: harden Windows installer bootstrap"
```

### Task 4: Generate the COS-first installation prompt

**Files:**
- Modify: `test/platform/install-prompt.test.mjs`
- Modify: `test/platform/prompt-install-flow.test.mjs`
- Modify: `src/platform/installations/install-prompt.mjs`

- [ ] **Step 1: Write failing prompt tests**

Use a release descriptor containing all six URLs and assert:

```js
assert.match(prompt, /未发现 xiaoye-image 是正常情况/);
assert.match(prompt, /download\.xiaoyeai\.cn/);
assert.match(prompt, /github\.com\/shuyejing-cmd\/xiaoye_gptimage/);
assert.match(prompt, /-ExecutionPolicy Bypass/);
assert.match(prompt, /重启 WorkBuddy.*新会话.*get_balance/s);
assert.match(prompt, /安装码.*不得转发/);
assert.doesNotMatch(prompt, /wb_live_/);
```

Assert malformed HTTP URLs, a COS URL outside `/releases/v1.2.1/`, and a GitHub repository mismatch are rejected.

- [ ] **Step 2: Run and verify RED**

Run:

```text
node --test test/platform/install-prompt.test.mjs test/platform/prompt-install-flow.test.mjs
```

Expected: FAIL because the current prompt accepts only GitHub and lacks Bypass.

- [ ] **Step 3: Implement explicit URL validation and prompt text**

Create separate validators:

```js
function requirePrimaryAsset(value, { baseUrl, version, fileName }) {
  const url = new URL(value);
  const base = new URL(baseUrl);
  const expectedPath = `/releases/v${version}/${fileName}`;
  if (url.protocol !== "https:" || url.origin !== base.origin || url.pathname !== expectedPath || url.search || url.hash) {
    throw new Error("腾讯云安装资源地址无效");
  }
  return url.href;
}

function requireGitHubFallback(value, { repository, version, fileName }) {
  const expectedPath = `/${repository}/releases/download/v${version}/${fileName}`;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expectedPath || url.search || url.hash) {
    throw new Error("GitHub备用安装资源地址无效");
  }
  return url.href;
}
```

Generate a single approved PowerShell flow with `-ExecutionPolicy Bypass`, COS-first download, GitHub fallback, explicit cleanup, the common error-to-action mapping from the design, and the restart/new-session instruction. Do not include the long-lived Key or claim success unless output is exactly `installed`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the two prompt test files. Expected: all PASS.

- [ ] **Step 5: Commit**

```text
git add src/platform/installations/install-prompt.mjs test/platform/install-prompt.test.mjs test/platform/prompt-install-flow.test.mjs
git commit -m "feat: generate COS-first WorkBuddy install prompts"
```

### Task 5: Verify COS releases without downloading the EXE

**Files:**
- Create: `src/platform/installations/cos-release-store.mjs`
- Create: `test/platform/cos-release-store.test.mjs`
- Modify: `src/platform/installations/release-service.mjs`
- Modify: `src/platform/runtime.mjs`
- Modify: `test/platform/release-service.test.mjs`

- [ ] **Step 1: Write a failing COS metadata adapter test**

Define the adapter contract:

```js
const store = createCosReleaseStore({
  cos: {
    headObject(params, callback) {
      callback(null, {
        headers: {
          "content-length": "25418544",
          "x-cos-meta-sha256": "7fe42d41b2191d92c3300960166a88dcf97187c7ea9a8d076466bd63f066c365"
        }
      });
    }
  },
  bucket: "workbuddy-release-1250000000",
  region: "ap-shanghai"
});

assert.deepEqual(await store.head("releases/v1.2.1/setup.exe"), {
  size: 25418544,
  sha256: "7fe42d41b2191d92c3300960166a88dcf97187c7ea9a8d076466bd63f066c365"
});
```

Also test missing/invalid metadata maps to a stable `release_asset_invalid` error without logging credentials or raw headers.

- [ ] **Step 2: Run and verify RED**

Run `node --test test/platform/cos-release-store.test.mjs`.

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the COS adapter**

Implement `createCosReleaseStore({ cos, bucket, region })` with a Promise wrapper around `cos.headObject`. Return only normalized `size` and lowercase `sha256`; reject a non-positive size or a digest outside `/^[a-f0-9]{64}$/`.

- [ ] **Step 4: Write failing release-service tests**

Assert that the service:

```js
assert.equal(status.ready, true);
assert.equal(status.version, "1.2.1");
assert.equal(status.installer_url.startsWith("https://download.xiaoyeai.cn/"), true);
assert.equal(status.fallback_installer_url.startsWith("https://github.com/"), true);
assert.equal(fetchCalls.includes(status.installer_url), false);
assert.deepEqual(headCalls, ["releases/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe"]);
```

Add failure tests for COS hash mismatch, undersized EXE, missing bootstrap, network timeout, and a GitHub outage that does not make an otherwise valid COS primary release unavailable.

- [ ] **Step 5: Implement COS-primary release verification**

Refactor `createReleaseService` to accept:

```js
createReleaseService({
  repository,
  version,
  primaryBaseUrl,
  releaseStore,
  fetchImpl,
  now,
  cacheTtlMs
});
```

Fetch only the COS manifest and bootstrap. Call `releaseStore.head()` for the EXE, compare size and SHA-256, and construct GitHub fallback URLs deterministically. Keep the 15-second request timeout and five-minute cache. Do not call the GitHub API on the request path.

- [ ] **Step 6: Wire the adapter into runtime**

In `createPlatformRuntime`, reuse the configured COS client but pass the dedicated release bucket/region:

```js
const releaseStore = createCosReleaseStore({
  cos,
  bucket: config.releaseCos.bucket,
  region: config.releaseCos.region
});
const releaseService = createReleaseService({
  repository: config.releaseRepository,
  version: config.installerVersion,
  primaryBaseUrl: config.releaseCos.baseUrl,
  releaseStore
});
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```text
node --test test/platform/cos-release-store.test.mjs test/platform/release-service.test.mjs test/platform/platform-app.test.mjs
```

Expected: all PASS and no test fetches installer bytes.

- [ ] **Step 8: Commit**

```text
git add src/platform test/platform/cos-release-store.test.mjs test/platform/release-service.test.mjs
git commit -m "feat: verify COS installer release metadata"
```

### Task 6: Update the website and operator documentation

**Files:**
- Modify: `web/src/main.jsx`
- Create: `test/web-install-page.test.mjs`
- Modify: `README.md`
- Modify: `docs/operations/production-launch-checklist.md`

- [ ] **Step 1: Add a failing website copy test**

Assert that the installation page says Tencent Cloud is primary and GitHub is fallback, and no longer claims every download comes from GitHub:

```js
assert.match(source, /腾讯云.*主下载/);
assert.match(source, /GitHub.*备用/);
assert.doesNotMatch(source, /请确认下载地址来自本项目官方GitHub Release/);
```

- [ ] **Step 2: Run and verify RED**

Run `node --test test/web-install-page.test.mjs`.

Expected: FAIL on the old GitHub-only copy.

- [ ] **Step 3: Update the website and docs**

Use this user-facing copy:

```text
安装文件优先从腾讯云下载，GitHub提供备用下载。
当前为公开内测版，Windows可能显示“未知发布者”。
安装完成后请重启 WorkBuddy，再开启 xiaoye-image 并检查余额。
```

Document the four release environment variables, immutable `releases/v1.2.1/` path, COS public-read scope, and rollback to the still-available v1.2.0 GitHub release.

- [ ] **Step 4: Verify website tests and build**

Run:

```text
node --test test/web-install-page.test.mjs
npm run web:build
```

Expected: PASS and Vite exits 0.

- [ ] **Step 5: Commit**

```text
git add web/src/main.jsx test/web-install-page.test.mjs README.md docs/operations/production-launch-checklist.md
git commit -m "docs: explain Tencent installer downloads"
```

### Task 7: Automate one-build GitHub and COS publication

**Files:**
- Create: `installer/publish-cos-release.mjs`
- Create: `test/platform/cos-release-publisher.test.mjs`
- Modify: `.github/workflows/release.yml`
- Modify: `package.json`

- [ ] **Step 1: Write a failing publisher test**

Inject a fake COS client and assert upload order, public metadata, and manifest-last semantics:

```js
assert.deepEqual(uploads.map((item) => item.key), [
  "releases/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe",
  "releases/v1.2.1/workbuddy-image-mcp.ps1",
  "releases/v1.2.1/workbuddy-image-mcp-1.2.1.json"
]);
assert.equal(uploads[0].headers["x-cos-meta-sha256"], manifest.sha256);
assert.equal(uploads[2].key.endsWith(".json"), true);
```

Simulate the second upload failing and assert the manifest is never uploaded.

- [ ] **Step 2: Run and verify RED**

Run `node --test test/platform/cos-release-publisher.test.mjs`.

Expected: FAIL because the publisher does not exist.

- [ ] **Step 3: Implement the publisher**

Export `publishCosRelease({ cos, bucket, region, version, outputDir })`. Read the three local files, verify manifest hash against the EXE, and upload with `cos.putObject` in the exact tested order. Set `Cache-Control: public,max-age=31536000,immutable`; set the EXE metadata SHA-256; never log credentials.

Add `npm run release:cos` as:

```json
"release:cos": "node installer/publish-cos-release.mjs"
```

- [ ] **Step 4: Update the GitHub Actions workflow**

Trigger only on `v1.2.1`. Keep tests and Inno build, then publish the complete GitHub draft Release. After GitHub succeeds, run COS publication with these GitHub Secrets/variables:

```yaml
env:
  COS_SECRET_ID: ${{ secrets.TENCENT_COS_RELEASE_SECRET_ID }}
  COS_SECRET_KEY: ${{ secrets.TENCENT_COS_RELEASE_SECRET_KEY }}
  WORKBUDDY_RELEASE_COS_BUCKET: ${{ vars.WORKBUDDY_RELEASE_COS_BUCKET }}
  WORKBUDDY_RELEASE_COS_REGION: ${{ vars.WORKBUDDY_RELEASE_COS_REGION }}
  WORKBUDDY_RELEASE_BASE_URL: https://download.xiaoyeai.cn
  WORKBUDDY_RELEASE_REPOSITORY: ${{ github.repository }}
```

After upload, download the public COS manifest/bootstrap, verify sizes, and use the publisher's COS metadata check to compare the EXE SHA-256. Fail the job if any check differs.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```text
node --test test/platform/cos-release-publisher.test.mjs test/platform/installer-release.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```text
git add installer/publish-cos-release.mjs test/platform/cos-release-publisher.test.mjs .github/workflows/release.yml package.json
git commit -m "ci: publish installer releases to Tencent COS"
```

### Task 8: Run complete local verification and synchronize the public repository

**Files:**
- Modify in public repository: `.github/workflows/release.yml`
- Modify in public repository: `installer/**`
- Modify in public repository: `package.json`, `package-lock.json`
- Modify in public repository: relevant `test/**`

- [ ] **Step 1: Run complete commercial repository verification**

Run:

```text
npm test
npm run web:build
git diff --check
```

Expected: zero failures; a Windows symlink test may skip for lack of privilege.

- [ ] **Step 2: Export only public bridge and installer changes**

Copy the approved public subset to `C:\Users\Midiec\Documents\Codex\2026-07-26\xiaoye_gptimage`. Do not copy `src/platform`, website code, `.env`, deployment configuration, database code, provider credentials, COS credentials, or payment code.

Set the public package version to `1.2.1`, add `cos-nodejs-sdk-v5` for the release publisher, add the `release:cos` script, and regenerate its lockfile with `npm install --package-lock-only`.

- [ ] **Step 3: Scan the public repository**

Run:

```text
rg -n "SMTP_PASS|COS_SECRET_KEY|DATABASE_URL|wb_live_|wb_install_|MCP_GATEWAY_TOKEN" . --glob '!package-lock.json'
npm test
git diff --check
```

Expected: secret scan has no real credential matches; public tests have zero failures.

- [ ] **Step 4: Commit and push public source without tagging**

```text
git add .github installer src test package.json package-lock.json README.md
git commit -m "release: prepare WorkBuddy image MCP 1.2.1"
git push origin main
```

Do not create `v1.2.1` until the COS bucket, domain, GitHub Secrets, and variables in Task 9 are verified.

### Task 9: Configure Tencent COS and GitHub publication credentials

**User action required before this task can complete.**

- [ ] **Step 1: Create the dedicated release bucket**

In Tencent COS, create a standard storage bucket in `ap-shanghai`. Record its full bucket name in `WORKBUDDY_RELEASE_COS_BUCKET`. Do not reuse the bucket that stores private images or payment proofs.

- [ ] **Step 2: Configure read access**

Keep writes private. Allow anonymous read only for the `releases/` prefix. Confirm an unauthenticated GET to a missing test object returns 404 rather than 403 after the prefix policy is active.

- [ ] **Step 3: Bind the download domain**

Bind `download.xiaoyeai.cn`, configure HTTPS, and add the Tencent-provided CNAME record. If domestic CDN is enabled, enable COS origin access and immutable caching for `/releases/*`.

Verification:

```text
curl -I https://download.xiaoyeai.cn/releases/health-check.txt
```

Expected after uploading a small health-check object: HTTP 200 over HTTPS.

- [ ] **Step 4: Create the limited release credential**

Create a Tencent CAM credential limited to listing the release bucket and reading/writing objects below `releases/`. It must not have access to private image or payment buckets.

- [ ] **Step 5: Configure GitHub repository settings**

In `shuyejing-cmd/xiaoye_gptimage`, create:

```text
Secret: TENCENT_COS_RELEASE_SECRET_ID
Secret: TENCENT_COS_RELEASE_SECRET_KEY
Variable: WORKBUDDY_RELEASE_COS_BUCKET
Variable: WORKBUDDY_RELEASE_COS_REGION=ap-shanghai
```

Never paste the secret values into chat, source files, Actions logs, or server commands.

- [ ] **Step 6: Report only non-secret identifiers**

Return only the full bucket name, region, and confirmation that both GitHub Secrets exist. These values unblock Task 10.

### Task 10: Publish v1.2.1 and deploy the commercial API configuration

**Files:**
- Modify on server: `/opt/workbuddy-image-mcp/.env`
- Deploy commercial branch build to: `/opt/workbuddy-image-mcp`

- [ ] **Step 1: Create and push the immutable tag**

From the public repository after Task 9:

```text
git tag -a v1.2.1 -m "WorkBuddy Image MCP 1.2.1"
git push origin v1.2.1
```

- [ ] **Step 2: Watch the release workflow**

Run:

```text
$runId = gh run list --repo shuyejing-cmd/xiaoye_gptimage --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runId --repo shuyejing-cmd/xiaoye_gptimage --exit-status
```

Expected: GitHub Release and COS publication steps both succeed. If either fails, do not move or recreate the tag until confirming no partial public Release is marked ready.

- [ ] **Step 3: Verify all public artifacts**

Verify the three COS URLs and three GitHub URLs are non-empty. Compare the manifest SHA-256 with GitHub asset digest and COS `x-cos-meta-sha256`. Expected: all three values are identical.

- [ ] **Step 4: Update the production environment**

Back up `/opt/workbuddy-image-mcp/.env`. Read the full bucket name recorded in Task 9 into `RELEASE_BUCKET`, validate that it ends in `-[0-9]+`, then append the release settings with `printf` so the recorded value is used rather than a template:

```bash
read -r -p "COS release bucket full name: " RELEASE_BUCKET
printf '%s' "$RELEASE_BUCKET" | grep -Eq -- '-[0-9]+$' || exit 1
sudo sed -i '/^WORKBUDDY_INSTALLER_VERSION=/d;/^WORKBUDDY_RELEASE_BASE_URL=/d;/^WORKBUDDY_RELEASE_COS_BUCKET=/d;/^WORKBUDDY_RELEASE_COS_REGION=/d;/^WORKBUDDY_RELEASE_REPOSITORY=/d' /opt/workbuddy-image-mcp/.env
printf '%s\n' \
  'WORKBUDDY_INSTALLER_VERSION=1.2.1' \
  'WORKBUDDY_RELEASE_BASE_URL=https://download.xiaoyeai.cn' \
  "WORKBUDDY_RELEASE_COS_BUCKET=$RELEASE_BUCKET" \
  'WORKBUDDY_RELEASE_COS_REGION=ap-shanghai' \
  'WORKBUDDY_RELEASE_REPOSITORY=shuyejing-cmd/xiaoye_gptimage' |
  sudo tee -a /opt/workbuddy-image-mcp/.env >/dev/null
unset RELEASE_BUCKET
```

- [ ] **Step 5: Deploy with the existing backup and rollback procedure**

Build API, worker, legacy gateway, and website images before cutover. Start PostgreSQL first, then API/worker/legacy gateway/Caddy. Preserve the old directory, `.env`, `tasks-data`, `caddy-data`, and PostgreSQL volume backup until end-to-end acceptance passes.

- [ ] **Step 6: Verify production health and release readiness**

Run:

```text
curl -fsS https://xiaoyeai.cn/healthz
curl -fsS https://xiaoyeai.cn/readyz
```

Expected: `{"status":"ok"}` and `{"status":"ready"}`. From an authenticated website session, `/api/install-release/status` must return `ready:true`, version `1.2.1`, a Tencent installer URL, and GitHub fallback fields in under 15 seconds.

### Task 11: Complete the Windows end-to-end acceptance

**Files:**
- Update evidence: `docs/operations/production-launch-checklist.md`

- [ ] **Step 1: Prepare the acceptance machine**

Use a Windows user without Node.js and without `xiaoye-image`. Confirm effective PowerShell policy is Restricted and create a Temp child file that inherits normal Windows ACL entries.

- [ ] **Step 2: Test the primary COS path**

From a real website account:

```text
Create Key → copy prompt → send to WorkBuddy → approve local command
→ install reports exactly installed → restart WorkBuddy
→ enable xiaoye-image → get_balance succeeds
```

Confirm the downloaded EXE came from `download.xiaoyeai.cn`, the prompt/logs contain no `wb_live_` Key, and the temporary install directory is gone.

- [ ] **Step 3: Test GitHub fallback**

Block `download.xiaoyeai.cn` on the acceptance machine, issue a new one-time installation prompt, and verify GitHub fallback installs the same SHA-256 artifact. Restore normal networking afterwards.

- [ ] **Step 4: Test clean failure**

Block both Tencent and GitHub, issue another new prompt, and verify no installer executes, no success is claimed, and the temporary token/bootstrap files are removed.

- [ ] **Step 5: Test actionable errors**

Verify used and expired installation codes direct the user to “重新生成”; a missing/ambiguous WorkBuddy config reports the exact next action; a post-write self-check failure restores the original MCP configuration.

- [ ] **Step 6: Record evidence and commit**

Add the test time, Windows version, WorkBuddy version, release URLs, SHA-256, and redacted result screenshots to the production checklist. Do not include email codes, one-time installation codes, personal Keys, or signed URLs.

```text
git add docs/operations/production-launch-checklist.md
git commit -m "docs: record WorkBuddy installer 1.2.1 acceptance"
```

## Completion gate

Do not advertise the 1.2.1 installer until all conditions hold:

- commercial and public repository tests pass;
- COS and GitHub contain the same immutable 1.2.1 artifacts;
- production release status returns ready in under 15 seconds;
- the current administrator WorkBuddy still works;
- the clean Windows COS-primary test passes;
- the forced GitHub fallback test passes;
- the dual-source failure test produces no false success;
- the old v1.2.0 GitHub Release and server rollback backups remain available through the observation period.
