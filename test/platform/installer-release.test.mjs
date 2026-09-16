import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(source, /finally\s*\{/);
  assert.match(source, /Remove-Item[^\n]+TokenFile/i);
  assert.doesNotMatch(source, /Invoke-Expression/i);
  assert.doesNotMatch(source, /ExecutionPolicy\s+Bypass/i);
});

test("unsigned installer builds cannot publish into website directories", async () => {
  const source = await readFile("installer/build-installer.ps1", "utf8");
  const signedBranch = source.indexOf("if ($env:CODE_SIGN_CERT_SHA1)");
  const installPublish = source.indexOf("web\\public\\install");
  const downloadsPublish = source.indexOf("web\\public\\downloads");
  assert.ok(signedBranch >= 0 && installPublish > signedBranch && downloadsPublish > signedBranch);
  assert.match(source, /Get-FileHash[^\n]+SHA256/);
  assert.match(source, /release-manifest\.mjs/);
});
