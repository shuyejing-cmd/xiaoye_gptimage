import test from "node:test";
import assert from "node:assert/strict";
import { loadPlatformConfig } from "../../src/platform/config.mjs";

const baseEnv = {
  DATABASE_URL: "postgresql://example",
  AUTH_PEPPER: "auth",
  API_KEY_PEPPER: "keys",
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
