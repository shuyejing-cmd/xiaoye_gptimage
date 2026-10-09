import { AppError } from "../shared/errors.mjs";
import { resolveProviderImage } from "./provider-image-result.mjs";
import { createProviderUnreachableError, normalizeProviderError } from "./provider-error.mjs";

const DEFAULT_BASE_URL = "https://api.gpt.ge/v1";
const DEFAULT_MODEL = "gpt-image-2.5-sunburst";
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const sizes = {
  "auto": "auto", "1:1": "1024x1024", "3:2": "1248x832", "2:3": "832x1248",
  "4:3": "1152x864", "3:4": "864x1152", "5:4": "1120x896", "4:5": "896x1120",
  "16:9": "1344x752", "9:16": "752x1344", "2:1": "1440x720", "1:2": "720x1440",
  "3:1": "1536x512", "1:3": "512x1536", "21:9": "1344x576"
};

function providerSize(request) {
  const base = sizes[request.size] || "1024x1024";
  const [width, height] = (base === "auto" ? "1024x1024" : base).split("x").map(Number);
  const scale = request.resolution === "4k" ? 4 : request.resolution === "2k" || request.resolution === "auto" || !request.resolution ? 2 : 1;
  return `${width * scale}x${height * scale}`;
}

const providerFields = (request, model) => ({ model, prompt: request.prompt, n: 1, size: providerSize(request), quality: request.quality, output_format: request.output_format });
const logProviderFailure = (logger, error) => logger?.error?.({ event: "provider_request_failed", ...error.diagnostic });

function normalizeReferenceImages({ referenceImage, referenceImages }) {
  const images = referenceImages ?? (referenceImage ? [referenceImage] : []);
  if (!Array.isArray(images)) throw new AppError({ code: "invalid_reference_images", message: "reference images must be an array", httpStatus: 400 });
  if (images.length > MAX_REFERENCE_IMAGES) throw new AppError({ code: "too_many_reference_images", message: "at most four reference images are allowed", httpStatus: 400 });
  for (const image of images) {
    if (!image?.buffer || image.buffer.length > MAX_REFERENCE_IMAGE_BYTES) throw new AppError({ code: "reference_image_too_large", message: "gpt.ge reference image cannot exceed 4 MiB", httpStatus: 400 });
  }
  return images;
}

export function createGptGeClient({ apiKey, baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL, fetchImpl = fetch, dnsLookup, logger = console }) {
  const apiBaseUrl = baseUrl.replace(/\/+$/, "");

  async function send(path, init) {
    let response;
    try {
      response = await fetchImpl(`${apiBaseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) } });
    } catch (cause) {
      const error = createProviderUnreachableError({ provider: "gpt_ge", cause });
      logProviderFailure(logger, error);
      throw error;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = normalizeProviderError({ provider: "gpt_ge", status: response.status, body });
      logProviderFailure(logger, error);
      throw error;
    }
    return body;
  }

  async function resolve(body, requestId) {
    try {
      return await resolveProviderImage(body, { fetchImpl, dnsLookup });
    } catch (error) {
      if (error?.code === "provider_protocol_error") logger.error({ event: "provider_protocol_error", requestId, httpStatus: 200, ...error.diagnostic });
      throw error;
    }
  }

  return {
    mode: "synchronous",
    async generate({ request, referenceImage, referenceImages, requestId }) {
      const images = normalizeReferenceImages({ referenceImage, referenceImages });
      if (images.length) {
        const form = new FormData();
        for (const [key, value] of Object.entries(providerFields(request, model))) form.set(key, String(value));
        for (const image of images) form.append("image", new Blob([image.buffer], { type: image.mimeType }), image.fileName);
        return resolve(await send("/images/edits", { method: "POST", body: form }), requestId);
      }
      return resolve(await send("/images/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(providerFields(request, model)) }), requestId);
    }
  };
}
