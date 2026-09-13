import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/gateway/config.mjs";

const common = { APIMART_API_KEY: "apimart", MCP_GATEWAY_TOKEN: "token", COS_SECRET_ID: "id", COS_SECRET_KEY: "secret", COS_BUCKET: "bucket", COS_REGION: "ap-shanghai" };

test("selects gpt.ge without replacing APIMart configuration", () => {
  const config = loadConfig({ ...common, IMAGE_PROVIDER: "gpt_ge", GPT_GE_API_KEY: "gpt-ge-key" });
  assert.equal(config.imageProvider, "gpt_ge");
  assert.equal(config.gptGe.apiKey, "gpt-ge-key");
  assert.equal(config.apiKey, "apimart");
  assert.equal(config.gptGe.baseUrl, "https://api.gpt.ge/v1");
});
test("gpt.ge does not require an APIMart key when selected", () => {
  const { APIMART_API_KEY, ...withoutApimart } = common;
  const config = loadConfig({ ...withoutApimart, IMAGE_PROVIDER: "gpt_ge", GPT_GE_API_KEY: "gpt-ge-key" });
  assert.equal(config.imageProvider, "gpt_ge");
});