import test from "node:test";
import assert from "node:assert/strict";
import { createProviderRegistry } from "../../src/platform/generation/provider-registry.mjs";

test("registers both providers using a direct transport", () => {
  const seen = [];
  const directFetch = async () => {};
  const providers = createProviderRegistry({
    gptGe: { apiKey: "gpt-secret", baseUrl: "https://api.gpt.ge/v1" },
    apimart: { apiKey: "apimart-secret", baseUrl: "https://api.apib.ai/v1" }
  }, {
    directFetch,
    createGptGe: (options) => { seen.push(["gpt_ge", options]); return { name: "gpt_ge" }; },
    createApimart: (options) => { seen.push(["apimart", options]); return { name: "apimart" }; }
  });
  assert.equal(providers.gpt_ge.name, "gpt_ge");
  assert.equal(providers.apimart.name, "apimart");
  assert.equal(seen.find(([name]) => name === "gpt_ge")[1].fetchImpl, directFetch);
  assert.equal(seen.find(([name]) => name === "apimart")[1].fetchImpl, directFetch);
  assert.equal(seen.find(([name]) => name === "proxy"), undefined);
});

test("fails fast instead of silently losing historical provider reconciliation", () => {
  assert.throws(() => createProviderRegistry({
    gptGe: { apiKey: undefined },
    apimart: { apiKey: "apimart-secret", baseUrl: "https://api.apib.ai/v1" }
  }, {
    createGptGe: () => { throw new Error("must not create"); },
    createApimart: () => ({ name: "apimart" })
  }), (error) => error.code === "missing_provider_config");
});
