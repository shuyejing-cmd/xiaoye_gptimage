import { createGptGeClient } from "../../gateway/gpt-ge-client.mjs";
import { createApimartClient } from "../../gateway/apimart-client.mjs";
import { createProxyFetch } from "../../gateway/proxy-fetch.mjs";

export function createProviderRegistry(config, {
  directFetch = fetch,
  createProxyTransport = createProxyFetch,
  createGptGe = createGptGeClient,
  createApimart = createApimartClient
} = {}) {
  const providers = {};
  if (config.gptGe?.apiKey) providers.gpt_ge = createGptGe({ ...config.gptGe, fetchImpl: directFetch });
  if (config.apimart?.apiKey) {
    const proxyFetch = createProxyTransport({ proxyUrl: config.apimart.proxyUrl, fetchImpl: directFetch });
    providers.apimart = createApimart({ ...config.apimart, fetchImpl: proxyFetch });
  }
  return providers;
}
