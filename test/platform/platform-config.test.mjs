import test from "node:test";
import assert from "node:assert/strict";
import { loadPlatformConfig } from "../../src/platform/config.mjs";

const baseEnv = {
  DATABASE_URL: "postgresql://example",
  AUTH_PEPPER: "auth",
  API_KEY_PEPPER: "keys",
  INSTALLATION_TOKEN_PEPPER: "installations",
  API_KEY_ENCRYPTION_KEY: "11".repeat(32),
  PAYLOAD_ENCRYPTION_KEY: "00".repeat(32),
  COS_SECRET_ID: "id",
  COS_SECRET_KEY: "secret",
  COS_BUCKET: "bucket",
  COS_REGION: "ap-shanghai",
  SMTP_HOST: "smtp.example.test",
  SMTP_FROM: "sender@example.test",
  GPT_GE_API_KEY: "provider-key"
};

test("website cookies stay secure by default", () => {
  assert.equal(loadPlatformConfig(baseEnv).cookieSecure, true);
});

test("local development can explicitly disable secure cookies", () => {
  assert.equal(loadPlatformConfig({ ...baseEnv, COOKIE_SECURE: "false" }).cookieSecure, false);
});

test("installation tokens use an independent pepper and versioned public origin", () => {
  const config = loadPlatformConfig(baseEnv);
  assert.equal(config.installationTokenPepper, "installations");
  assert.equal(config.publicOrigin, "https://xiaoyeai.cn");
  assert.equal(config.installerVersion, "1.2.0");
  assert.equal(config.releaseRepository, null);
  assert.equal(loadPlatformConfig({ ...baseEnv, WORKBUDDY_RELEASE_REPOSITORY: "owner/repository" }).releaseRepository, "owner/repository");
  assert.throws(() => loadPlatformConfig({ ...baseEnv, INSTALLATION_TOKEN_PEPPER: "" }), (error) => error.code === "missing_config");
  assert.throws(() => loadPlatformConfig({ ...baseEnv, PUBLIC_ORIGIN: "http://xiaoyeai.cn" }), (error) => error.code === "invalid_config");
  assert.throws(() => loadPlatformConfig({ ...baseEnv, WORKBUDDY_INSTALLER_VERSION: "latest" }), (error) => error.code === "invalid_config");
  assert.throws(() => loadPlatformConfig({ ...baseEnv, WORKBUDDY_RELEASE_REPOSITORY: "not a repository" }), (error) => error.code === "invalid_config");
});
