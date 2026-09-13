import { AppError } from "../shared/errors.mjs";
import { createProviderUnreachableError, normalizeProviderError } from "./provider-error.mjs";

const DEFAULT_BASE_URL = "https://api.apimart.ai/v1";
const normalizeBaseUrl = (value) => (value || DEFAULT_BASE_URL).replace(/\/+$/, "");
const logProviderFailure = (logger, error) => logger?.error?.({ event: "provider_request_failed", ...error.diagnostic });

export function createApimartClient({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, logger = console }) {
  const apiBaseUrl = normalizeBaseUrl(baseUrl);

  async function call(path, init) {
    let response;
    try {
      response = await fetchImpl(`${apiBaseUrl}${path}`, {
        ...init,
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
    async submit(request) {
      const body = { model: "gpt-image-2-official", ...request };
      if (request.reference_image_url) {
        body.image_urls = [request.reference_image_url];
        delete body.reference_image_url;
      }
      const response = await call("/images/generations", { method: "POST", body: JSON.stringify(body) });
      const taskId = response?.data?.[0]?.task_id;
      if (!taskId) throw new AppError({ code: "provider_protocol_error", message: "provider returned no task id", httpStatus: 502 });
      return { taskId };
    },
    async getTask(taskId) {
      const response = await call(`/tasks/${taskId}`, { method: "GET" });
      const task = response?.data;
      if (!task?.status) throw new AppError({ code: "provider_protocol_error", message: "provider returned invalid task", httpStatus: 502 });
      return { status: task.status, imageUrl: task.result?.images?.[0]?.url?.[0], expiresAt: task.result?.images?.[0]?.expires_at };
    }
  };
}