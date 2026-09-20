import test from "node:test";
import assert from "node:assert/strict";
import { createProviderRegistry } from "../../src/platform/generation/provider-registry.mjs";

test("registers both configured providers and proxies APIMart only", () => {
  const seen = [];
  const directFetch = async () => {};
  const proxyFetch = async () => {};
  const providers = createProviderRegistry({
    gptGe: { apiKey: "gpt-secret", baseUrl: "https://api.gpt.ge/v1" },
    apimart: { apiKey: "apimart-secret", baseUrl: "https://api.apimart.ai/v1", proxyUrl: "http://mihomo:7890" }
  }, {
    directFetch,
    createProxyTransport: (options) => { seen.push(["proxy", options]); return proxyFetch; },
    createGptGe: (options) => { seen.push(["gpt_ge", options]); return { name: "gpt_ge" }; },
    createApimart: (options) => { seen.push(["apimart", options]); return { name: "apimart" }; }
  });
  assert.equal(providers.gpt_ge.name, "gpt_ge");
  assert.equal(providers.apimart.name, "apimart");
  assert.equal(seen.find(([name]) => name === "gpt_ge")[1].fetchImpl, directFetch);
  assert.equal(seen.find(([name]) => name === "apimart")[1].fetchImpl, proxyFetch);
  assert.equal(seen.find(([name]) => name === "proxy")[1].proxyUrl, "http://mihomo:7890");
});

test("keeps an unconfigured rollback provider out of the registry", () => {
  const providers = createProviderRegistry({
    gptGe: { apiKey: undefined },
    apimart: { apiKey: "apimart-secret", proxyUrl: "http://mihomo:7890" }
  }, {
    createProxyTransport: () => async () => {},
    createGptGe: () => { throw new Error("must not create"); },
    createApimart: () => ({ name: "apimart" })
  });
  assert.deepEqual(Object.keys(providers), ["apimart"]);
});
