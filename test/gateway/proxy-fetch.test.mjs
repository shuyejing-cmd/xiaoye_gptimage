import test from "node:test";
import assert from "node:assert/strict";
import { createProxyFetch } from "../../src/gateway/proxy-fetch.mjs";

test("adds one explicit proxy dispatcher without mutating unrelated fetch calls", async () => {
  const dispatcher = { name: "proxy-dispatcher" };
  const calls = [];
  const proxiedFetch = createProxyFetch({
    proxyUrl: "http://mihomo:7890",
    dispatcherFactory: (url) => { assert.equal(url, "http://mihomo:7890"); return dispatcher; },
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response("{}"); }
  });
  await proxiedFetch("https://api.apimart.ai/v1/models", { headers: { accept: "application/json" } });
  assert.equal(calls[0].init.dispatcher, dispatcher);
  assert.deepEqual(calls[0].init.headers, { accept: "application/json" });
});
