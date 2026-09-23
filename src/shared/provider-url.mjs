import { AppError } from "./errors.mjs";

export function providerBaseUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { /* validated below */ }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new AppError({ code: "invalid_config", message: `${name} must be a plain HTTPS URL`, httpStatus: 500 });
  }
  return url.href.replace(/\/+$/, "");
}
