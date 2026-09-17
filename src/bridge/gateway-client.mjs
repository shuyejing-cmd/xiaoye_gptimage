import { randomUUID } from "node:crypto";
import { AppError } from "../shared/errors.mjs";
const generationEndpoint = (baseUrl) => new URL("/v1/generations", baseUrl).toString();

export function createGatewayClient({ baseUrl, token, apiKey = token, fetchImpl = fetch, idempotencyKeyFactory = randomUUID, pollIntervalMs = 2000, pollTimeoutMs = 90000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  async function send(url, { method = "GET", body, headers = {} } = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response;
      try { response = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${apiKey}`, ...headers }, body, signal: AbortSignal.timeout(100000) }); }
      catch {
        if (attempt === 0) continue;
        throw new AppError({ code: "gateway_unreachable", message: "image gateway is unavailable", httpStatus: 502, retryable: true });
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) continue;
        throw new AppError({ code: payload?.error?.code || "gateway_error", message: payload?.error?.message || "image gateway request failed", httpStatus: response.status, retryable: response.status >= 500 });
      }
      return payload;
    }
  }
  async function getGeneration(requestId) {
    return send(new URL(`/v1/generations/${encodeURIComponent(requestId)}`, baseUrl).toString());
  }
  async function waitForGeneration(initial) {
    const terminal = new Set(["succeeded", "failed", "completed"]);
    if (!initial?.request_id || !initial.status || terminal.has(initial.status)) return initial;
    const deadline = Date.now() + pollTimeoutMs;
    let current = initial;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      current = await getGeneration(initial.request_id);
      if (terminal.has(current.status)) return current;
    }
    return { ...current, message: "图片仍在处理中，请稍后使用 get_generation 查询任务状态。" };
  }
  async function generateWithReferences(request, images) {
    const form = new FormData();
    form.set("request", JSON.stringify(request));
    for (const image of images) form.append("image", new Blob([image.buffer], { type: image.mimeType }), image.fileName);
    return waitForGeneration(await send(generationEndpoint(baseUrl), { method: "POST", body: form, headers: { "Idempotency-Key": idempotencyKeyFactory() } }));
  }
  return {
    generateText: async (request) => waitForGeneration(await send(generationEndpoint(baseUrl), { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKeyFactory() } })),
    generateWithReferences,
    generateWithReference: (request, image) => generateWithReferences(request, [image]),
    getGeneration,
    getBalance: () => send(new URL("/v1/account/balance", baseUrl).toString())
  };
}
