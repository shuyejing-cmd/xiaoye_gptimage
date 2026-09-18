const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MIN_BOOTSTRAP_BYTES = 1024;
const DEFAULT_MIN_INSTALLER_BYTES = 10 * 1024 * 1024;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const RELEASE_CHECK_TIMEOUT_MS = 15_000;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function requireBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new TypeError("Release base URL must use HTTPS");
  return url.href.replace(/\/+$/, "");
}

export function buildReleaseAssets({ repository, version, releaseBaseUrl }) {
  if (!REPOSITORY_PATTERN.test(String(repository || ""))) throw new TypeError("Invalid GitHub release repository");
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ""))) throw new TypeError("Invalid installer version");
  const githubBaseUrl = `https://github.com/${repository}/releases/download/v${version}`;
  const primaryBaseUrl = releaseBaseUrl ? requireBaseUrl(releaseBaseUrl) : githubBaseUrl;
  return {
    repository,
    version,
    releaseBaseUrl: primaryBaseUrl,
    bootstrapUrl: `${primaryBaseUrl}/workbuddy-image-mcp.ps1`,
    manifestUrl: `${primaryBaseUrl}/workbuddy-image-mcp-${version}.json`,
    installerUrl: `${primaryBaseUrl}/WorkBuddy-Image-MCP-Setup-${version}.exe`,
    fallbackBootstrapUrl: `${githubBaseUrl}/workbuddy-image-mcp.ps1`,
    fallbackManifestUrl: `${githubBaseUrl}/workbuddy-image-mcp-${version}.json`,
    fallbackInstallerUrl: `${githubBaseUrl}/WorkBuddy-Image-MCP-Setup-${version}.exe`
  };
}

export function buildGitHubReleaseAssets({ repository, version }) {
  const assets = buildReleaseAssets({ repository, version });
  return {
    repository: assets.repository,
    version: assets.version,
    releaseBaseUrl: assets.releaseBaseUrl,
    bootstrapUrl: assets.bootstrapUrl,
    manifestUrl: assets.manifestUrl,
    installerUrl: assets.installerUrl
  };
}

async function download(fetchImpl, url, { minimumBytes = 1, maximumBytes = MAX_ASSET_BYTES } = {}) {
  const response = await fetchImpl(url, {
    redirect: "follow",
    headers: { accept: "application/octet-stream", "user-agent": "workbuddy-commercial-platform/1.2.1" },
    signal: AbortSignal.timeout(RELEASE_CHECK_TIMEOUT_MS)
  });
  if (!response?.ok) throw new Error("release_asset_unavailable");
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && (declared < minimumBytes || declared > maximumBytes)) throw new Error("release_asset_size_invalid");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < minimumBytes || bytes.length > maximumBytes) throw new Error("release_asset_size_invalid");
  return bytes;
}

async function verifyInstallerHead(fetchImpl, url, { minimumBytes }) {
  const response = await fetchImpl(url, {
    method: "HEAD",
    redirect: "follow",
    headers: { "user-agent": "workbuddy-commercial-platform/1.2.1" },
    signal: AbortSignal.timeout(RELEASE_CHECK_TIMEOUT_MS)
  });
  if (!response?.ok) throw new Error("release_asset_unavailable");
  const size = Number(response.headers?.get?.("content-length"));
  if (!Number.isFinite(size) || size < minimumBytes || size > MAX_ASSET_BYTES) throw new Error("release_asset_size_invalid");
}

function unavailable(version, manifestUrl = null) {
  return { ready: false, version, manifest_url: manifestUrl, message: "安装服务准备中" };
}

export function createReleaseService({
  repository,
  version,
  releaseBaseUrl,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  minBootstrapBytes = DEFAULT_MIN_BOOTSTRAP_BYTES,
  minInstallerBytes = DEFAULT_MIN_INSTALLER_BYTES
}) {
  let assets = null;
  try { if (repository) assets = buildReleaseAssets({ repository, version, releaseBaseUrl }); } catch { assets = null; }
  let cached = null;
  let cacheExpiresAt = 0;
  let pending = null;

  async function inspect() {
    if (!assets || typeof fetchImpl !== "function") return unavailable(version);
    try {
      const manifestBytes = await download(fetchImpl, assets.manifestUrl, { maximumBytes: 64 * 1024 });
      let manifest;
      try { manifest = JSON.parse(manifestBytes.toString("utf8")); } catch { throw new Error("release_manifest_invalid"); }
      if (manifest?.version !== version ||
          manifest?.installer_url !== assets.installerUrl ||
          !/^([a-f0-9]{64})$/i.test(String(manifest?.sha256 || "")) ||
          typeof manifest?.signed !== "boolean" ||
          (manifest.signed && manifest.publisher !== "CN=Xiaoye AI") ||
          !Array.isArray(manifest?.fallback_installer_urls) ||
          manifest.fallback_installer_urls[0] !== assets.fallbackInstallerUrl) {
        throw new Error("release_manifest_invalid");
      }
      await download(fetchImpl, assets.bootstrapUrl, { minimumBytes: minBootstrapBytes, maximumBytes: 1024 * 1024 });
      await verifyInstallerHead(fetchImpl, assets.installerUrl, { minimumBytes: minInstallerBytes });
      return {
        ready: true,
        version,
        manifest_url: assets.manifestUrl,
        bootstrap_url: assets.bootstrapUrl,
        installer_url: assets.installerUrl,
        fallback_manifest_url: assets.fallbackManifestUrl,
        fallback_bootstrap_url: assets.fallbackBootstrapUrl,
        fallback_installer_url: assets.fallbackInstallerUrl
      };
    } catch {
      return unavailable(version, assets.manifestUrl);
    }
  }

  return {
    async getStatus() {
      const currentTime = Number(now());
      if (cached && currentTime < cacheExpiresAt) return cached;
      if (pending) return pending;
      pending = inspect().then((status) => {
        cached = status;
        cacheExpiresAt = Number(now()) + cacheTtlMs;
        return status;
      }).finally(() => { pending = null; });
      return pending;
    }
  };
}
