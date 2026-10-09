import { AppError } from "../shared/errors.mjs";
import { createProviderUnreachableError, normalizeProviderError } from "./provider-error.mjs";
import { resolveProviderImage } from "./provider-image-result.mjs";

const DEFAULT_BASE_URL = "https://api.apib.ai/v1";
const normalizeBaseUrl = (value) => (value || DEFAULT_BASE_URL).replace(/\/+$/, "");
const logProviderFailure = (logger, error) => logger?.error?.({ event: "provider_request_failed", ...error.diagnostic });

export function createApimartClient({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model = "gpt-image-2.5-sunburst",
  fetchImpl = fetch,
  signalFactory = (milliseconds) => AbortSignal.timeout(milliseconds),
  logger = console
}) {
  const apiBaseUrl = normalizeBaseUrl(baseUrl);

  async function call(path, init, timeoutMs) {
    let response;
    try {
      response = await fetchImpl(`${apiBaseUrl}${path}`, {
        ...init,
        signal: signalFactory(timeoutMs),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init.headers || {}) }
      });
    } catch (cause) {
      const error = createProviderUnreachableError({ provider: "apimart", cause });
      logProviderFailure(logger, error);
      throw error;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = normalizeProviderError({ provider: "apimart", status: response.status, body });
      logProviderFailure(logger, error);
      throw error;
    }
    return body;
  }

  return {
    mode: "asynchronous",
    async healthCheck() {
      await call("/models", { method: "GET" }, 10_000);
      return { available: true, checkedAt: new Date().toISOString() };
    },
    async submit(request) {
      const body = {
        model,
        prompt: request.prompt,
        size: request.size,
        resolution: request.resolution,
        quality: request.quality,
        output_format: request.output_format,
        n: request.n
      };
      if (request.referenceImageUrls?.length) body.image_urls = request.referenceImageUrls;
      const response = await call("/images/generations", { method: "POST", body: JSON.stringify(body) }, 30_000);
      const taskId = response?.data?.[0]?.task_id;
      if (!taskId) throw new AppError({ code: "provider_protocol_error", message: "provider returned no task id", httpStatus: 502 });
      return { taskId };
    },
    async getTask(taskId) {
      const response = await call(`/tasks/${taskId}`, { method: "GET" }, 15_000);
      const task = response?.data;
      if (!task?.status) throw new AppError({ code: "provider_protocol_error", message: "provider returned invalid task", httpStatus: 502 });
      return {
        status: task.status,
        upstreamCost: typeof task.cost === "number" && Number.isFinite(task.cost) && task.cost >= 0 && task.cost < 1_000_000 ? task.cost : null,
        imageUrl: task.result?.images?.[0]?.url?.[0],
        expiresAt: task.result?.images?.[0]?.expires_at,
        errorCode: task.error?.code || task.error_code
      };
    },
    downloadImage(url) {
      return resolveProviderImage({ data: [{ url }] }, { fetchImpl, timeoutMs: 120_000, maxImageBytes: 50 * 1024 * 1024 });
    }
  };
}
