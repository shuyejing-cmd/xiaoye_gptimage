import { AppError } from "../shared/errors.mjs";
import { resolveProviderImage } from "./provider-image-result.mjs";
import { createProviderUnreachableError, normalizeProviderError } from "./provider-error.mjs";

const DEFAULT_BASE_URL = "https://api.gpt.ge/v1";
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const sizes = {
  "auto": "auto", "1:1": "832x832", "3:2": "832x560", "2:3": "560x832",
  "4:3": "832x624", "3:4": "624x832", "5:4": "832x672", "4:5": "672x832",
  "16:9": "832x464", "9:16": "464x832", "2:1": "832x416", "1:2": "416x832",
  "3:1": "832x272", "1:3": "272x832", "21:9": "832x352"
};

const providerFields = (request) => ({ model: "gpt-image-2", prompt: request.prompt, n: 1, size: sizes[request.size] || "auto", quality: request.quality, output_format: request.output_format });
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

export function createGptGeClient({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, dnsLookup, logger = console }) {
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
        for (const [key, value] of Object.entries(providerFields(request))) form.set(key, String(value));
        for (const image of images) form.append("image", new Blob([image.buffer], { type: image.mimeType }), image.fileName);
        return resolve(await send("/images/edits", { method: "POST", body: form }), requestId);
      }
      return resolve(await send("/images/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(providerFields(request)) }), requestId);
    }
  };
}