import test from "node:test";
import assert from "node:assert/strict";

let environmentPaths;
try { environmentPaths = await import("../../src/bridge/environment-paths.mjs"); }
catch { environmentPaths = {}; }

test("expands Windows environment tokens in allowed image roots", () => {
  assert.equal(typeof environmentPaths.expandEnvironmentTokens, "function");
  assert.equal(environmentPaths.expandEnvironmentTokens("%USERPROFILE%/Pictures", { USERPROFILE: "C:/Users/Alice" }), "C:/Users/Alice/Pictures");
});

test("keeps an unknown environment token intact", () => {
  assert.equal(typeof environmentPaths.expandEnvironmentTokens, "function");
  assert.equal(environmentPaths.expandEnvironmentTokens("%UNKNOWN%/Pictures", {}), "%UNKNOWN%/Pictures");
});
