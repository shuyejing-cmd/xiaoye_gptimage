import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { buildReleaseManifest } from "../../installer/release-manifest.mjs";

test("release manifest uses the stable public contract", () => {
  assert.deepEqual(buildReleaseManifest({
    version: "1.2.0",
    sha256: "a".repeat(64),
    signed: false,
    installerUrl: "https://github.com/example/workbuddy/releases/download/v1.2.0/WorkBuddy-Image-MCP-Setup-1.2.0.exe"
  }), {
    version: "1.2.0",
    sha256: "a".repeat(64),
    channel: "beta",
    signed: false,
    installer_url: "https://github.com/example/workbuddy/releases/download/v1.2.0/WorkBuddy-Image-MCP-Setup-1.2.0.exe"
  });
  assert.equal(buildReleaseManifest({ version: "1.2.0", sha256: "a".repeat(64), signed: true, publisher: "CN=Xiaoye AI", installerUrl: "https://github.com/example/workbuddy/releases/download/v1.2.0/setup.exe" }).publisher, "CN=Xiaoye AI");
});

test("release manifest rejects non-HTTPS installers and malformed fields", () => {
  assert.throws(() => buildReleaseManifest({ version: "1", sha256: "bad", publisher: "", installerUrl: "http://example.test/setup.exe" }));
});

test("bootstrap verifies transport, digest, optional signature, and cleanup before execution", async () => {
  const source = await readFile("installer/workbuddy-image-mcp-bootstrap.ps1", "utf8");
  assert.match(source, /Scheme[^\n]+https/i);
  assert.match(source, /SecurityProtocol.*Tls12/);
  assert.ok(source.indexOf("ManifestPath") < source.indexOf("InstallerPath"), "manifest must be handled before installer");
  assert.match(source, /Get-FileHash[^\n]+SHA256/);
  assert.match(source, /Get-AuthenticodeSignature/);
  assert.match(source, /Status[^\n]+Valid/);
  assert.match(source, /ExpectedPublisher/);
  assert.match(source, /SignerCertificate\.Subject/);
  assert.match(source, /\/TOKENFILE=/);
  assert.match(source, /\/RESULTFILE=/);
  assert.match(source, /finally\s*\{/);
  assert.match(source, /Remove-Item[^\n]+TokenFile/i);
  assert.doesNotMatch(source, /Invoke-Expression/i);
  assert.doesNotMatch(source, /ExecutionPolicy\s+Bypass/i);
  assert.match(source, /\[Parameter\(Mandatory=\$true\)\]\[string\]\$ManifestUrl/);
  assert.doesNotMatch(source, /xiaoyeai\.cn\/install/);
  assert.match(source, /if \(\$Manifest\.signed\)/);
});

test("bootstrap never deletes a rejected token path outside the user temp directory", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(join(process.cwd(), "wb-bootstrap-unsafe-"));
  const tokenFile = join(directory, "important.txt");
  await writeFile(tokenFile, "keep-me");
  try {
    await assert.rejects(promisify(execFile)("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-File", "installer/workbuddy-image-mcp-bootstrap.ps1", "-TokenFile", tokenFile
      , "-ManifestUrl", "https://github.com/example/workbuddy/releases/download/v1.2.0/workbuddy-image-mcp-1.2.0.json"
    ], { windowsHide: true }));
    await access(tokenFile);
    assert.equal(await readFile(tokenFile, "utf8"), "keep-me");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unsigned installer builds stage all three GitHub release assets without website publishing", async () => {
  const source = await readFile("installer/build-installer.ps1", "utf8");
  assert.match(source, /WORKBUDDY_RELEASE_REPOSITORY/);
  assert.match(source, /WorkBuddy-Image-MCP-Setup-\$Version\.exe/);
  assert.match(source, /workbuddy-image-mcp-\$Version\.json/);
  assert.match(source, /workbuddy-image-mcp\.ps1/);
  assert.doesNotMatch(source, /web\\public\\(?:install|downloads)/);
  assert.match(source, /Get-FileHash[^\n]+SHA256/);
  assert.match(source, /release-manifest\.mjs/);
  assert.match(source, /Set-AuthenticodeSignature/);
  assert.match(source, /--signed=\$Signed/);
});

test("GitHub Actions publishes one validated v1.2.0 release atomically", async () => {
  const source = await readFile(".github/workflows/release.yml", "utf8");
  assert.match(source, /v1\.2\.0/);
  assert.match(source, /node-version:\s*22/);
  assert.match(source, /npm test/);
  assert.match(source, /npm run web:build/);
  assert.match(source, /installer:build/);
  for (const name of ["workbuddy-image-mcp.ps1", "workbuddy-image-mcp-1.2.0.json", "WorkBuddy-Image-MCP-Setup-1.2.0.exe"]) assert.match(source, new RegExp(name.replaceAll(".", "\\.")));
  assert.match(source, /--draft/);
  assert.match(source, /release delete/);
  assert.match(source, /release edit[^\n]+--draft=false/);
});

test("release version and fixed publisher stay synchronized across artifacts", async () => {
  const [bootstrap, build, inno, config, app] = await Promise.all([
    readFile("installer/workbuddy-image-mcp-bootstrap.ps1", "utf8"),
    readFile("installer/build-installer.ps1", "utf8"),
    readFile("installer/workbuddy-image-mcp.iss", "utf8"),
    readFile("src/platform/config.mjs", "utf8"),
    readFile("src/platform/http/platform-app.mjs", "utf8")
  ]);
  const values = {
    bootstrap: bootstrap.match(/\$ExpectedVersion = '([^']+)'/)?.[1],
    build: build.match(/\$Version = '([^']+)'/)?.[1],
    inno: inno.match(/^AppVersion=(.+)$/m)?.[1].trim(),
    config: config.match(/WORKBUDDY_INSTALLER_VERSION \|\| "([^"]+)"/)?.[1],
    app: app.match(/installerVersion = "([^"]+)"/)?.[1]
  };
  assert.deepEqual(new Set(Object.values(values)), new Set(["1.2.0"]));
  const publishers = {
    bootstrap: bootstrap.match(/\$ExpectedPublisher = '([^']+)'/)?.[1],
    build: build.match(/\$ExpectedPublisher = '([^']+)'/)?.[1]
  };
  assert.deepEqual(new Set(Object.values(publishers)), new Set(["CN=Xiaoye AI"]));
});
