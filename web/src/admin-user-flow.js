export function adminUsersPath(rawEmail = "") {
  const email = String(rawEmail).trim();
  return email ? `/api/admin/users?email=${encodeURIComponent(email)}` : "/api/admin/users";
}

export function preparePointAddition(user, rawAmount, rawReason) {
  const amount = Number(rawAmount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("请输入大于 0 的正整数积分");
  const reason = String(rawReason || "").trim();
  if (!reason) throw new Error("请填写加分原因");
  const nextAvailable = Number(user.available_points) + amount;
  if (!Number.isSafeInteger(nextAvailable)) throw new Error("调整后积分超出允许范围");
  return { amount, reason, nextAvailable };
}

export function pointAdditionRequest(previous, userId, addition, makeKey) {
  const id = String(userId);
  return previous?.userId === id && previous.amount === addition.amount && previous.reason === addition.reason
    ? previous
    : { userId: id, amount: addition.amount, reason: addition.reason, key: makeKey() };
}

export const pendingAdditionKey = "admin_pending_point_addition_v1";

export function loadPendingPointAddition(storage) {
  try {
    const request = JSON.parse(storage.getItem(pendingAdditionKey) || "null");
    return request && typeof request.userId === "string" && request.userId &&
      Number.isSafeInteger(request.amount) && request.amount > 0 &&
      typeof request.reason === "string" && request.reason.trim() &&
      typeof request.key === "string" && request.key ? request : null;
  } catch { return null; }
}

export function savePendingPointAddition(storage, request) {
  const current = loadPendingPointAddition(storage);
  if (current && current.key !== request.key) throw new Error("还有一笔未确认的加分，请先重试确认");
  storage.setItem(pendingAdditionKey, JSON.stringify(request));
}

export function clearPendingPointAddition(storage, request) {
  try {
    const current = loadPendingPointAddition(storage);
    if (current?.key === request.key && current.userId === request.userId && current.amount === request.amount && current.reason === request.reason) storage.removeItem(pendingAdditionKey);
  } catch { /* Keep the request for a safe retry if storage becomes unavailable. */ }
  return loadPendingPointAddition(storage);
}

export function createAdminLoadTracker() {
  let latest = 0;
  return { next: () => ++latest, isCurrent: number => number === latest };
}

export function retainUnconfirmedPointAddition({ isRetry, httpStatus }) {
  return isRetry || !httpStatus || httpStatus >= 500;
}
