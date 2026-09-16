import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { buildReleaseManifest } from "../../installer/release-manifest.mjs";

test("release manifest uses the stable public contract", () => {
  assert.deepEqual(buildReleaseManifest({
    version: "1.1.0",
    sha256: "a".repeat(64),
    publisher: "CN=Xiaoye AI",
    installerUrl: "https://xiaoyeai.cn/install/WorkBuddy-Image-MCP-Setup-1.1.0.exe"
  }), {
    version: "1.1.0",
    sha256: "a".repeat(64),
    publisher: "CN=Xiaoye AI",
    installer_url: "https://xiaoyeai.cn/install/WorkBuddy-Image-MCP-Setup-1.1.0.exe"
  });
});

test("release manifest rejects non-HTTPS installers and malformed fields", () => {
  assert.throws(() => buildReleaseManifest({ version: "1", sha256: "bad", publisher: "", installerUrl: "http://example.test/setup.exe" }));
});

test("bootstrap verifies transport, digest, signature, publisher, and cleanup before execution", async () => {
  const source = await readFile("installer/workbuddy-image-mcp-bootstrap.ps1", "utf8");
  assert.match(source, /https:/i);
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
});

test("bootstrap never deletes a rejected token path outside the user temp directory", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(join(process.cwd(), "wb-bootstrap-unsafe-"));
  const tokenFile = join(directory, "important.txt");
  await writeFile(tokenFile, "keep-me");
  try {
    await assert.rejects(promisify(execFile)("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-File", "installer/workbuddy-image-mcp-bootstrap.ps1", "-TokenFile", tokenFile
    ], { windowsHide: true }));
    await access(tokenFile);
    assert.equal(await readFile(tokenFile, "utf8"), "keep-me");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unsigned installer builds cannot publish into website directories", async () => {
  const source = await readFile("installer/build-installer.ps1", "utf8");
  const signedBranch = source.indexOf("if ($env:CODE_SIGN_CERT_SHA1)");
  const installPublish = source.indexOf("web\\public\\install");
  const downloadsPublish = source.indexOf("web\\public\\downloads");
  assert.ok(signedBranch >= 0 && installPublish > signedBranch && downloadsPublish > signedBranch);
  assert.match(source, /Get-FileHash[^\n]+SHA256/);
  assert.match(source, /release-manifest\.mjs/);
  assert.match(source, /Set-AuthenticodeSignature/);
  assert.match(source, /Copy-Item -LiteralPath \$SignedBootstrapPath/);
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
    manifestUrl: bootstrap.match(/workbuddy-image-mcp-(\d+\.\d+\.\d+)\.json/)?.[1],
    build: build.match(/\$Version = '([^']+)'/)?.[1],
    inno: inno.match(/^AppVersion=(.+)$/m)?.[1].trim(),
    config: config.match(/WORKBUDDY_INSTALLER_VERSION \|\| "([^"]+)"/)?.[1],
    app: app.match(/installerVersion = "([^"]+)"/)?.[1]
  };
  assert.deepEqual(new Set(Object.values(values)), new Set(["1.1.0"]));
  const publishers = {
    bootstrap: bootstrap.match(/\$ExpectedPublisher = '([^']+)'/)?.[1],
    build: build.match(/\$ExpectedPublisher = '([^']+)'/)?.[1]
  };
  assert.deepEqual(new Set(Object.values(publishers)), new Set(["CN=Xiaoye AI"]));
});
