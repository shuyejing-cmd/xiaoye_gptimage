import { AppError } from "../shared/errors.mjs";
const endpoint = (baseUrl) => new URL("/v1/bridge/generations", baseUrl).toString();

export function createGatewayClient({ baseUrl, token, fetchImpl = fetch }) {
  async function send(body, headers = {}) {
    let response;
    try { response = await fetchImpl(endpoint(baseUrl), { method: "POST", headers: { Authorization: `Bearer ${token}`, ...headers }, body, signal: AbortSignal.timeout(100000) }); }
    catch { throw new AppError({ code: "gateway_unreachable", message: "image gateway is unavailable", httpStatus: 502, retryable: true }); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new AppError({ code: payload?.error?.code || "gateway_error", message: payload?.error?.message || "image gateway request failed", httpStatus: response.status, retryable: response.status >= 500 });
    return payload;
  }
  async function generateWithReferences(request, images) {
    const form = new FormData();
    form.set("request", JSON.stringify(request));
    for (const image of images) form.append("image", new Blob([image.buffer], { type: image.mimeType }), image.fileName);
    return send(form);
  }
  return {
    generateText: (request) => send(JSON.stringify(request), { "content-type": "application/json" }),
    generateWithReferences,
    generateWithReference: (request, image) => generateWithReferences(request, [image])
  };
}