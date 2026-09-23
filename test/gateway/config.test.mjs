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
  assert.equal(config.gptGe.model, "gpt-image-2.5-sunburst");
});

test("allows the gpt.ge image model to be changed without editing code", () => {
  const config = loadConfig({ ...common, IMAGE_PROVIDER: "gpt_ge", GPT_GE_API_KEY: "gpt-ge-key", GPT_GE_IMAGE_MODEL: "future-image-model" });
  assert.equal(config.gptGe.model, "future-image-model");
});
test("gpt.ge does not require an APIMart key when selected", () => {
  const { APIMART_API_KEY, ...withoutApimart } = common;
  const config = loadConfig({ ...withoutApimart, IMAGE_PROVIDER: "gpt_ge", GPT_GE_API_KEY: "gpt-ge-key" });
  assert.equal(config.imageProvider, "gpt_ge");
});

test("legacy gateway defaults to the domestic APIMart URL and rejects insecure provider URLs", () => {
  assert.equal(loadConfig(common).apiBaseUrl, "https://api.apib.ai/v1");
  assert.throws(() => loadConfig({ ...common, APIMART_BASE_URL: "http://api.apib.ai/v1" }), (error) => error.code === "invalid_config");
  assert.throws(() => loadConfig({ ...common, GPT_GE_BASE_URL: "https://user:pass@api.gpt.ge/v1" }), (error) => error.code === "invalid_config");
});
