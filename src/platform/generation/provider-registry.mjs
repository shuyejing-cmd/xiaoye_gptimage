import { createGptGeClient } from "../../gateway/gpt-ge-client.mjs";
import { createApimartClient } from "../../gateway/apimart-client.mjs";
import { AppError } from "../../shared/errors.mjs";

export function createProviderRegistry(config, {
  directFetch = fetch,
  createGptGe = createGptGeClient,
  createApimart = createApimartClient
} = {}) {
  const providers = {};
  if (!config.gptGe?.apiKey || !config.apimart?.apiKey) throw new AppError({ code: "missing_provider_config", message: "Both provider credentials are required for historical task reconciliation", httpStatus: 500 });
  providers.gpt_ge = createGptGe({ ...config.gptGe, fetchImpl: directFetch });
  providers.apimart = createApimart({ ...config.apimart, fetchImpl: directFetch });
  return providers;
}
