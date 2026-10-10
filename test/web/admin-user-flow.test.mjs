import test from "node:test";
import assert from "node:assert/strict";

let flow;
try { flow = await import("../../web/src/admin-user-flow.js"); }
catch { flow = {}; }

test("admin account lookup sends the entered email to the server", () => {
  assert.equal(flow.adminUsersPath?.("  alice+tag@example.com  "), "/api/admin/users?email=alice%2Btag%40example.com");
  assert.equal(flow.adminUsersPath?.("   "), "/api/admin/users");
});

test("manual point addition keeps a positive integer and a written reason", () => {
  assert.deepEqual(flow.preparePointAddition?.({ available_points: 40 }, "12", "  线下收款补分  "), {
    amount: 12,
    reason: "线下收款补分",
    nextAvailable: 52
  });
  for (const amount of ["", "0", "-1", "1.5", "9007199254740992"]) {
    assert.throws(() => flow.preparePointAddition?.({ available_points: 40 }, amount, "线下收款"), /正整数/);
  }
  assert.throws(() => flow.preparePointAddition?.({ available_points: 40 }, "12", "   "), /原因/);
});

test("retrying the same manual addition reuses its idempotency key", () => {
  const first = flow.pointAdditionRequest?.(null, 17, { amount: 12, reason: "线下收款" }, () => "request-1");
  assert.deepEqual(first, { userId: "17", amount: 12, reason: "线下收款", key: "request-1" });
  assert.deepEqual(flow.pointAdditionRequest?.(first, 17, { amount: 12, reason: "线下收款" }, () => "request-2"), first);
  assert.deepEqual(flow.pointAdditionRequest?.(first, 17, { amount: 15, reason: "线下收款" }, () => "request-2"), { userId: "17", amount: 15, reason: "线下收款", key: "request-2" });
});

test("an uncertain point addition survives navigation and page reload until acknowledged", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const request = flow.pointAdditionRequest?.(null, 17, { amount: 12, reason: "线下收款" }, () => "request-1");
  flow.savePendingPointAddition?.(storage, request);
  assert.deepEqual(flow.loadPendingPointAddition?.(storage), request);
  const retry = flow.pointAdditionRequest?.(flow.loadPendingPointAddition?.(storage), 17, { amount: 12, reason: "线下收款" }, () => "request-2");
  assert.equal(retry?.key, "request-1");
  flow.clearPendingPointAddition?.(storage, request);
  assert.equal(flow.loadPendingPointAddition?.(storage), null);
});

test("an old tab cannot clear a newer tab's pending point addition", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const oldRequest = flow.pointAdditionRequest?.(null, 17, { amount: 12, reason: "线下收款 A" }, () => "request-1");
  const newRequest = flow.pointAdditionRequest?.(null, 18, { amount: 20, reason: "线下收款 B" }, () => "request-2");
  flow.savePendingPointAddition?.(storage, newRequest);
  assert.deepEqual(flow.clearPendingPointAddition?.(storage, oldRequest), newRequest);
  assert.deepEqual(flow.loadPendingPointAddition?.(storage), newRequest);
});

test("only the latest admin search response may update the visible users", () => {
  const tracker = flow.createAdminLoadTracker?.();
  const first = tracker?.next();
  const second = tracker?.next();
  assert.equal(tracker?.isCurrent(first), false);
  assert.equal(tracker?.isCurrent(second), true);
});

test("an expired login during retry cannot discard a possibly applied point addition", () => {
  assert.equal(flow.retainUnconfirmedPointAddition?.({ isRetry: true, httpStatus: 401 }), true);
  assert.equal(flow.retainUnconfirmedPointAddition?.({ isRetry: true, httpStatus: 403 }), true);
  assert.equal(flow.retainUnconfirmedPointAddition?.({ isRetry: false, httpStatus: 500 }), true);
  assert.equal(flow.retainUnconfirmedPointAddition?.({ isRetry: false, httpStatus: undefined }), true);
  assert.equal(flow.retainUnconfirmedPointAddition?.({ isRetry: false, httpStatus: 400 }), false);
});
