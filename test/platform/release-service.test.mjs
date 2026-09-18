import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildReleaseAssets, createReleaseService } from "../../src/platform/installations/release-service.mjs";

const repository = "xiaoye-ai/workbuddy-image-mcp";
const version = "1.2.1";
const releaseBaseUrl = "https://workbuddy-release.cos.ap-shanghai.myqcloud.com/releases/v1.2.1";
const assets = buildReleaseAssets({ repository, version, releaseBaseUrl });
const bootstrap = Buffer.from("bootstrap-ok");
const installer = Buffer.from("installer-binary-ok");
const sha256 = createHash("sha256").update(installer).digest("hex");

function response(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { "content-length": String(Buffer.byteLength(body || "")), ...headers } });
}

function validManifest(overrides = {}) {
  return {
    version,
    sha256,
    signed: false,
    installer_url: assets.installerUrl,
    fallback_installer_urls: [assets.fallbackInstallerUrl],
    ...overrides
  };
}

function fetcher({ manifest = validManifest(), bootstrapBody = bootstrap, installerSize = installer.length } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (url === assets.manifestUrl) return response(JSON.stringify(manifest));
    if (url === assets.bootstrapUrl) return response(bootstrapBody);
    if (url === assets.installerUrl && options.method === "HEAD") return response("", 200, { "content-length": String(installerSize) });
    return response("missing", 404);
  };
  return { calls, fetchImpl };
}

test("release URLs use Tencent as primary and GitHub as backup", () => {
  assert.deepEqual(assets, {
    repository,
    version,
    releaseBaseUrl,
    bootstrapUrl: `${releaseBaseUrl}/workbuddy-image-mcp.ps1`,
    manifestUrl: `${releaseBaseUrl}/workbuddy-image-mcp-1.2.1.json`,
    installerUrl: `${releaseBaseUrl}/WorkBuddy-Image-MCP-Setup-1.2.1.exe`,
    fallbackBootstrapUrl: "https://github.com/xiaoye-ai/workbuddy-image-mcp/releases/download/v1.2.1/workbuddy-image-mcp.ps1",
    fallbackManifestUrl: "https://github.com/xiaoye-ai/workbuddy-image-mcp/releases/download/v1.2.1/workbuddy-image-mcp-1.2.1.json",
    fallbackInstallerUrl: "https://github.com/xiaoye-ai/workbuddy-image-mcp/releases/download/v1.2.1/WorkBuddy-Image-MCP-Setup-1.2.1.exe"
  });
  assert.throws(() => buildReleaseAssets({ repository, version, releaseBaseUrl: "http://download.example.com/releases/v1.2.1" }), /HTTPS/i);
});

test("release status validates the small Tencent files and only HEADs the installer", async () => {
  let now = 1000;
  const fake = fetcher();
  const service = createReleaseService({ repository, version, releaseBaseUrl, fetchImpl: fake.fetchImpl, now: () => now, minBootstrapBytes: bootstrap.length, minInstallerBytes: installer.length });
  const [first, concurrent] = await Promise.all([service.getStatus(), service.getStatus()]);
  assert.equal(first.ready, true);
  assert.deepEqual(concurrent, first);
  assert.deepEqual(fake.calls, [
    { url: assets.manifestUrl, method: "GET" },
    { url: assets.bootstrapUrl, method: "GET" },
    { url: assets.installerUrl, method: "HEAD" }
  ]);
  assert.equal(first.fallback_installer_url, assets.fallbackInstallerUrl);
  now += 299_999;
  await service.getStatus();
  assert.equal(fake.calls.length, 3);
});

for (const [name, options] of [
  ["empty bootstrap", { bootstrapBody: Buffer.alloc(0) }],
  ["wrong manifest version", { manifest: validManifest({ version: "1.2.0" }) }],
  ["missing signed flag", { manifest: (() => { const value = validManifest(); delete value.signed; return value; })() }],
  ["invalid signed flag", { manifest: validManifest({ signed: "false" }) }],
  ["missing signed publisher", { manifest: validManifest({ signed: true }) }],
  ["wrong primary installer URL", { manifest: validManifest({ installer_url: "https://example.com/setup.exe" }) }],
  ["missing installer", { installerSize: 0 }]
]) {
  test(`release status stays unavailable for ${name}`, async () => {
    const fake = fetcher(options);
    const service = createReleaseService({ repository, version, releaseBaseUrl, fetchImpl: fake.fetchImpl, minBootstrapBytes: bootstrap.length, minInstallerBytes: installer.length });
    const status = await service.getStatus();
    assert.equal(status.ready, false);
    assert.equal(status.version, version);
    assert.equal(status.message, "安装服务准备中");
  });
}

test("an unconfigured repository reports unavailable without network access", async () => {
  let called = false;
  const service = createReleaseService({ repository: "", version, releaseBaseUrl, fetchImpl: async () => { called = true; } });
  assert.equal((await service.getStatus()).ready, false);
  assert.equal(called, false);
});
