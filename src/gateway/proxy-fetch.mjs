import { ProxyAgent } from "undici";

export function createProxyFetch({ proxyUrl, fetchImpl = fetch, dispatcherFactory = (url) => new ProxyAgent(url) }) {
  const dispatcher = dispatcherFactory(proxyUrl);
  return (url, init = {}) => fetchImpl(url, { ...init, dispatcher });
}
