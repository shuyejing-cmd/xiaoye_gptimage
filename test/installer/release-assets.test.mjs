import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildReleaseManifest } from "../../installer/release-manifest.mjs";

test("unsigned beta manifest exposes the versioned GitHub installer", () => {
  assert.deepEqual(buildReleaseManifest({
    version: "1.2.0",
    sha256: "a".repeat(64),
    signed: false,
    installerUrl: "https://github.com/shuyejing-cmd/xiaoye_gptimage/releases/download/v1.2.0/WorkBuddy-Image-MCP-Setup-1.2.0.exe"
  }), {
    version: "1.2.0",
    sha256: "a".repeat(64),
    channel: "beta",
    signed: false,
    installer_url: "https://github.com/shuyejing-cmd/xiaoye_gptimage/releases/download/v1.2.0/WorkBuddy-Image-MCP-Setup-1.2.0.exe"
  });
});

test("bootstrap requires a manifest and verifies digest, result, and cleanup", async () => {
  const source = await readFile("installer/workbuddy-image-mcp-bootstrap.ps1", "utf8");
  assert.match(source, /\[Parameter\(Mandatory=\$true\)\]\[string\]\$ManifestUrl/);
  assert.match(source, /Get-FileHash[^\n]+SHA256/);
  assert.match(source, /if \(\$Manifest\.signed\)/);
  assert.match(source, /\$InstallerResult -ne 'installed'/);
  assert.match(source, /finally\s*\{/);
  assert.doesNotMatch(source, /xiaoyeai\.cn\/install/);
});

test("build and workflow publish exactly the versioned GitHub release assets", async () => {
  const [build, workflow] = await Promise.all([
    readFile("installer/build-installer.ps1", "utf8"),
    readFile(".github/workflows/release.yml", "utf8")
  ]);
  assert.match(build, /WORKBUDDY_RELEASE_REPOSITORY/);
  assert.doesNotMatch(build, /web\\public/);
  assert.match(workflow, /v1\.2\.0/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /npm test/);
  assert.doesNotMatch(workflow, /web:build/);
  for (const name of ["workbuddy-image-mcp.ps1", "workbuddy-image-mcp-1.2.0.json", "WorkBuddy-Image-MCP-Setup-1.2.0.exe"]) {
    assert.match(workflow, new RegExp(name.replaceAll(".", "\\.")));
  }
  assert.match(workflow, /--draft/);
  assert.match(workflow, /release delete/);
});

test("public package contains only the bridge runtime contract", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.version, "1.2.0");
  assert.equal(pkg.engines.node, ">=22.13.0");
  assert.equal(pkg.scripts.bridge, "node src/index.mjs");
  assert.equal(pkg.scripts.gateway, undefined);
});
