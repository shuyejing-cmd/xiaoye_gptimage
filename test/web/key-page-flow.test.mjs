import test from "node:test";
import assert from "node:assert/strict";

let flow;
try { flow = await import("../../web/src/key-page-flow.js"); }
catch { flow = {}; }

test("creates a key, exposes it immediately, then requests its prompt", async () => {
  const events = [];
  const request = async (path) => {
    events.push(path);
    if (path === "/api/api-keys") return { id: "7", key: "wb_live_public_secret", status: "active" };
    return { prompt: "install me", expires_at: "2026-09-16T12:10:00.000Z" };
  };

  const result = await flow.createKeyWithPrompt({
    request,
    name: "WorkBuddy Windows",
    onKeyCreated: (key) => events.push(`visible:${key.id}`)
  });

  assert.deepEqual(events, ["/api/api-keys", "visible:7", "/api/api-keys/7/installation-token"]);
  assert.equal(result.prompt.prompt, "install me");
});

test("keeps the created key when prompt generation fails", async () => {
  const request = async (path) => {
    if (path === "/api/api-keys") return { id: "8", key: "wb_live_public_secret", status: "active" };
    throw new Error("请求过于频繁，请稍后再试");
  };

  const result = await flow.createKeyWithPrompt({ request, name: "WorkBuddy Windows", onKeyCreated: () => {} });

  assert.equal(result.key.id, "8");
  assert.equal(result.prompt, null);
  assert.equal(result.promptError, "请求过于频繁，请稍后再试");
});

test("detects both sides of the prompt expiry timestamp", () => {
  const expiry = "2026-09-16T12:10:00.000Z";
  assert.equal(flow.isPromptExpired(expiry, Date.parse("2026-09-16T12:09:59.999Z")), false);
  assert.equal(flow.isPromptExpired(expiry, Date.parse(expiry)), true);
});
