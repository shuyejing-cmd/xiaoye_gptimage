import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deleteRecoveredApiKey,
  exchangeInstallationToken,
  preserveRecoveredApiKey,
  readRecoveredApiKey,
  recoveredKeyFile,
  restrictPrivateFile,
  verifyPrivateTokenFile
} from "../../installer/installation-client.mjs";

async function tokenFixture(value = "wb_install_public_secret") {
  const directory = await mkdtemp(join(tmpdir(), "wb-install-token-"));
  const tokenFile = join(directory, "token.txt");
  await writeFile(tokenFile, `  ${value}\r\n`, { mode: 0o600 });
  return tokenFile;
}

async function assertDeleted(path) {
  await assert.rejects(readFile(path, "utf8"), (error) => error.code === "ENOENT");
}

test("exchange posts the trimmed token and always deletes the token file", async () => {
  const tokenFile = await tokenFixture();
  let request;
  const result = await exchangeInstallationToken({
    gatewayUrl: "https://xiaoyeai.cn/",
    tokenFile,
    verifyTokenFile: async () => true,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({ api_key: "wb_live_public_secret", gateway_url: "https://xiaoyeai.cn" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(request.url, "https://xiaoyeai.cn/v1/installations/exchange");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { installation_token: "wb_install_public_secret" });
  assert.deepEqual(result, { apiKey: "wb_live_public_secret", gatewayUrl: "https://xiaoyeai.cn" });
  await assertDeleted(tokenFile);
});

test("exchange maps safe server codes without exposing token or response content", async () => {
  const tokenFile = await tokenFixture("wb_install_must_not_leak");
  await assert.rejects(
    exchangeInstallationToken({
      gatewayUrl: "https://xiaoyeai.cn",
      tokenFile,
      verifyTokenFile: async () => true,
      fetchImpl: async () => new Response(JSON.stringify({ error: "installation_token_expired", secret: "upstream-body-must-not-leak" }), { status: 410 })
    }),
    (error) => error.code === "installation_token_expired"
      && !error.message.includes("must_not_leak")
      && !error.message.includes("upstream-body")
  );
  await assertDeleted(tokenFile);
});

test("exchange deletes the token file when network access fails", async () => {
  const tokenFile = await tokenFixture();
  await assert.rejects(exchangeInstallationToken({
    gatewayUrl: "https://xiaoyeai.cn",
    tokenFile,
    verifyTokenFile: async () => true,
    fetchImpl: async () => { throw new Error("offline"); }
  }), (error) => error.code === "installation_exchange_unavailable");
  await assertDeleted(tokenFile);
});

test("exchange rejects an empty token with the public invalid-token code", async () => {
  const tokenFile = await tokenFixture("");
  await assert.rejects(exchangeInstallationToken({
    gatewayUrl: "https://xiaoyeai.cn",
    tokenFile,
    verifyTokenFile: async () => true,
    fetchImpl: async () => { throw new Error("must not fetch"); }
  }), (error) => error.code === "invalid_installation_token");
  await assertDeleted(tokenFile);
});

test("exchange rejects a token file that is not private to the current user", async () => {
  const tokenFile = await tokenFixture();
  await assert.rejects(exchangeInstallationToken({
    gatewayUrl: "https://xiaoyeai.cn",
    tokenFile,
    verifyTokenFile: async () => false,
    fetchImpl: async () => { throw new Error("must not fetch"); }
  }), (error) => error.code === "installation_token_file_insecure");
  await assertDeleted(tokenFile);
});

test("a recovered API key is private, reusable for repair, and deletable", async () => {
  const installDir = await mkdtemp(join(tmpdir(), "wb-recovered-key-"));
  let restrictedPath;
  let contentBeforeRestriction;
  const path = await preserveRecoveredApiKey({
    installDir,
    apiKey: "wb_live_recovered_secret",
    restrict: async (value) => {
      restrictedPath = value;
      contentBeforeRestriction = await readFile(value, "utf8");
    }
  });
  assert.equal(path, recoveredKeyFile(installDir));
  assert.equal(restrictedPath, path);
  assert.equal(contentBeforeRestriction, "");
  assert.equal(await readRecoveredApiKey(installDir), "wb_live_recovered_secret");
  await deleteRecoveredApiKey(installDir);
  assert.equal(await readRecoveredApiKey(installDir), null);
});

test("the Inno installer exposes token, config, and roots automation parameters", async () => {
  const source = await readFile("installer/workbuddy-image-mcp.iss", "utf8");
  assert.match(source, /\{param:TOKENFILE\|\}/);
  assert.match(source, /\{param:CONFIG\|\}/);
  assert.match(source, /\{param:ROOTS\|\}/);
  assert.match(source, /install-token/);
  assert.match(source, /DeleteFile\(TokenFileParam\)/);
  assert.match(source, /doctor --install-dir=/);
  assert.match(source, /uninstall --install-dir=/);
  assert.match(source, /RESULTFILE/);
  assert.doesNotMatch(source, /\{userpictures\}/i);
  assert.doesNotMatch(source, /\{userprofile\}/i);
  assert.match(source, /\{%USERPROFILE\}\\Pictures/);
});

test("Windows ACL verification accepts a file restricted to the current user", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "wb-token-acl-"));
  const tokenFile = join(directory, "token.txt");
  try {
    await writeFile(tokenFile, "redacted");
    await restrictPrivateFile(tokenFile);
    assert.equal(await verifyPrivateTokenFile(tokenFile), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows ACL verification rejects a missing token file", { skip: process.platform !== "win32" }, async () => {
  const missing = join(tmpdir(), `wb-missing-token-${crypto.randomUUID()}.txt`);
  assert.equal(await verifyPrivateTokenFile(missing), false);
});
