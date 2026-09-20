import test from "node:test";
import assert from "node:assert/strict";
import { createProviderAvailability } from "../../src/platform/generation/provider-availability.mjs";

test("caches provider availability for fifteen seconds", async () => {
  let now = 1_000;
  let calls = 0;
  const availability = createProviderAvailability({
    providerName: "apimart",
    provider: { healthCheck: async () => { calls += 1; return true; } },
    now: () => now
  });
  assert.equal(await availability.check(), true);
  now += 14_999;
  assert.equal(await availability.check(), true);
  assert.equal(calls, 1);
  now += 2;
  assert.equal(await availability.check(), true);
  assert.equal(calls, 2);
  assert.deepEqual(availability.snapshot(), { provider: "apimart", available: true, checked_at: new Date(now).toISOString() });
});

test("reports an unavailable provider without exposing its transport error", async () => {
  const availability = createProviderAvailability({
    providerName: "apimart",
    provider: { healthCheck: async () => { throw new Error("proxy secret and private endpoint"); } },
    now: () => 2_000
  });
  assert.equal(await availability.check(), false);
  assert.deepEqual(availability.snapshot(), { provider: "apimart", available: false, checked_at: new Date(2_000).toISOString() });
  assert.doesNotMatch(JSON.stringify(availability.snapshot()), /secret|endpoint/);
});
