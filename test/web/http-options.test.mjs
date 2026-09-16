import test from "node:test";
import assert from "node:assert/strict";

test("bodyless requests do not claim to contain JSON", async () => {
  let module;
  try { module = await import("../../web/src/http-options.js"); } catch { /* expected before implementation */ }
  assert.equal(typeof module?.requestHeaders, "function");
  assert.equal(module.requestHeaders({ method: "DELETE" }), undefined);
  assert.deepEqual(module.requestHeaders({ method: "POST", body: JSON.stringify({ name: "key" }) }), { "content-type": "application/json" });
});
