import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildGitHubReleaseAssets, createReleaseService } from "../../src/platform/installations/release-service.mjs";

const repository = "xiaoye-ai/workbuddy-image-mcp";
const version = "1.2.0";
const assets = buildGitHubReleaseAssets({ repository, version });
const bootstrap = Buffer.from("bootstrap-ok");
const installer = Buffer.from("installer-binary-ok");
const sha256 = createHash("sha256").update(installer).digest("hex");

function response(body, status = 200) {
  return new Response(body, { status, headers: { "content-length": String(Buffer.byteLength(body)) } });
}

function validManifest(overrides = {}) {
  return {
    version,
    sha256,
    installer_url: assets.installerUrl,
    ...overrides
  };
}

function fetcher({ manifest = validManifest(), bootstrapBody = bootstrap, installerBody = installer } = {}) {
  const calls = [];
  const releaseApiUrl = `https://api.github.com/repos/${repository}/releases/tags/v${version}`;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === assets.manifestUrl) return response(JSON.stringify(manifest));
    if (url === assets.bootstrapUrl) return response(bootstrapBody);
    if (url === releaseApiUrl) return response(JSON.stringify({
      tag_name: `v${version}`,
      assets: [{
        name: `WorkBuddy-Image-MCP-Setup-${version}.exe`,
        state: "uploaded",
        size: installerBody.length,
        digest: `sha256:${createHash("sha256").update(installerBody).digest("hex")}`,
        browser_download_url: assets.installerUrl
      }]
    }));
    return response("missing", 404);
  };
  return { calls, fetchImpl };
}

test("GitHub release URLs are fixed to the configured repository and version", () => {
  assert.deepEqual(assets, {
    repository,
    version,
    releaseBaseUrl: "https://github.com/xiaoye-ai/workbuddy-image-mcp/releases/download/v1.2.0",
    bootstrapUrl: "https://github.com/xiaoye-ai/workbuddy-image-mcp/releases/download/v1.2.0/workbuddy-image-mcp.ps1",
    manifestUrl: "https://github.com/xiaoye-ai/workbuddy-image-mcp/releases/download/v1.2.0/workbuddy-image-mcp-1.2.0.json",
    installerUrl: "https://github.com/xiaoye-ai/workbuddy-image-mcp/releases/download/v1.2.0/WorkBuddy-Image-MCP-Setup-1.2.0.exe"
  });
  assert.throws(() => buildGitHubReleaseAssets({ repository: "bad repository", version }), /repository/i);
});

test("release status validates all assets and caches the result for five minutes", async () => {
  let now = 1000;
  const fake = fetcher();
  const service = createReleaseService({ repository, version, fetchImpl: fake.fetchImpl, now: () => now, minBootstrapBytes: bootstrap.length, minInstallerBytes: installer.length });
  const [first, concurrent] = await Promise.all([service.getStatus(), service.getStatus()]);
  assert.equal(first.ready, true);
  assert.deepEqual(concurrent, first);
  assert.equal(fake.calls.length, 3);
  now += 299_999;
  await service.getStatus();
  assert.equal(fake.calls.length, 3);
  now += 2;
  await service.getStatus();
  assert.equal(fake.calls.length, 6);
});

test("release status verifies the installer from GitHub asset metadata without downloading the binary", async () => {
  const calls = [];
  const releaseApiUrl = `https://api.github.com/repos/${repository}/releases/tags/v${version}`;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === assets.manifestUrl) return response(JSON.stringify(validManifest()));
    if (url === assets.bootstrapUrl) return response(bootstrap);
    if (url === releaseApiUrl) {
      return response(JSON.stringify({
        tag_name: `v${version}`,
        assets: [{
          name: `WorkBuddy-Image-MCP-Setup-${version}.exe`,
          state: "uploaded",
          size: 25 * 1024 * 1024,
          digest: `sha256:${sha256}`,
          browser_download_url: assets.installerUrl
        }]
      }));
    }
    if (url === assets.installerUrl) throw new Error("installer_binary_should_not_be_downloaded");
    return response("missing", 404);
  };

  const service = createReleaseService({
    repository,
    version,
    fetchImpl,
    minBootstrapBytes: bootstrap.length,
    minInstallerBytes: installer.length
  });

  assert.equal((await service.getStatus()).ready, true);
  assert.equal(calls.includes(assets.installerUrl), false);
});

for (const [name, options] of [
  ["empty bootstrap", { bootstrapBody: Buffer.alloc(0) }],
  ["wrong manifest version", { manifest: validManifest({ version: "1.1.0" }) }],
  ["wrong installer hash", { manifest: validManifest({ sha256: "0".repeat(64) }) }]
]) {
  test(`release status stays unavailable for ${name}`, async () => {
    const fake = fetcher(options);
    const service = createReleaseService({ repository, version, fetchImpl: fake.fetchImpl, minBootstrapBytes: bootstrap.length, minInstallerBytes: installer.length });
    const status = await service.getStatus();
    assert.equal(status.ready, false);
    assert.equal(status.version, version);
    assert.equal(status.message, "安装服务准备中");
  });
}

test("an unconfigured repository reports unavailable without network access", async () => {
  let called = false;
  const service = createReleaseService({ repository: "", version, fetchImpl: async () => { called = true; } });
  assert.equal((await service.getStatus()).ready, false);
  assert.equal(called, false);
});
