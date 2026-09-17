const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MIN_BOOTSTRAP_BYTES = 1024;
const DEFAULT_MIN_INSTALLER_BYTES = 10 * 1024 * 1024;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const RELEASE_CHECK_TIMEOUT_MS = 15_000;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function buildGitHubReleaseAssets({ repository, version }) {
  if (!REPOSITORY_PATTERN.test(String(repository || ""))) throw new TypeError("Invalid GitHub release repository");
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ""))) throw new TypeError("Invalid installer version");
  const releaseBaseUrl = `https://github.com/${repository}/releases/download/v${version}`;
  return {
    repository,
    version,
    releaseBaseUrl,
    bootstrapUrl: `${releaseBaseUrl}/workbuddy-image-mcp.ps1`,
    manifestUrl: `${releaseBaseUrl}/workbuddy-image-mcp-${version}.json`,
    installerUrl: `${releaseBaseUrl}/WorkBuddy-Image-MCP-Setup-${version}.exe`
  };
}

async function download(fetchImpl, url, {
  minimumBytes = 1,
  maximumBytes = MAX_ASSET_BYTES,
  accept = "application/octet-stream"
} = {}) {
  const response = await fetchImpl(url, {
    redirect: "follow",
    headers: { accept, "user-agent": "workbuddy-commercial-platform/1.2.0" },
    signal: AbortSignal.timeout(RELEASE_CHECK_TIMEOUT_MS)
  });
  if (!response?.ok) throw new Error("release_asset_unavailable");
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && (declared < minimumBytes || declared > maximumBytes)) throw new Error("release_asset_size_invalid");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < minimumBytes || bytes.length > maximumBytes) throw new Error("release_asset_size_invalid");
  return bytes;
}

function unavailable(version, manifestUrl = null) {
  return { ready: false, version, manifest_url: manifestUrl, message: "安装服务准备中" };
}

export function createReleaseService({
  repository,
  version,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  minBootstrapBytes = DEFAULT_MIN_BOOTSTRAP_BYTES,
  minInstallerBytes = DEFAULT_MIN_INSTALLER_BYTES
}) {
  let assets = null;
  try { if (repository) assets = buildGitHubReleaseAssets({ repository, version }); } catch { assets = null; }
  let cached = null;
  let cacheExpiresAt = 0;
  let pending = null;

  async function inspect() {
    if (!assets || typeof fetchImpl !== "function") return unavailable(version);
    try {
      const manifestBytes = await download(fetchImpl, assets.manifestUrl, { maximumBytes: 64 * 1024 });
      let manifest;
      try { manifest = JSON.parse(manifestBytes.toString("utf8")); } catch { throw new Error("release_manifest_invalid"); }
      if (manifest?.version !== version || manifest?.installer_url !== assets.installerUrl || !/^[a-f0-9]{64}$/i.test(String(manifest?.sha256 || ""))) throw new Error("release_manifest_invalid");
      await download(fetchImpl, assets.bootstrapUrl, { minimumBytes: minBootstrapBytes, maximumBytes: 1024 * 1024 });
      const releaseApiUrl = `https://api.github.com/repos/${repository}/releases/tags/v${version}`;
      const releaseBytes = await download(fetchImpl, releaseApiUrl, {
        maximumBytes: 2 * 1024 * 1024,
        accept: "application/vnd.github+json"
      });
      let release;
      try { release = JSON.parse(releaseBytes.toString("utf8")); } catch { throw new Error("release_metadata_invalid"); }
      const installerName = `WorkBuddy-Image-MCP-Setup-${version}.exe`;
      const installerAsset = release?.tag_name === `v${version}`
        ? release.assets?.find((asset) => asset?.name === installerName)
        : null;
      const digest = String(installerAsset?.digest || "");
      if (installerAsset?.state !== "uploaded" ||
          installerAsset?.browser_download_url !== assets.installerUrl ||
          !Number.isFinite(installerAsset?.size) ||
          installerAsset.size < minInstallerBytes ||
          installerAsset.size > MAX_ASSET_BYTES ||
          digest.toLowerCase() !== `sha256:${manifest.sha256}`.toLowerCase()) {
        throw new Error("release_asset_invalid");
      }
      return {
        ready: true,
        version,
        manifest_url: assets.manifestUrl,
        bootstrap_url: assets.bootstrapUrl,
        installer_url: assets.installerUrl
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
