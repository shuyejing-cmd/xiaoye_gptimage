export function requestHeaders(options = {}) {
  if (options.body instanceof FormData || options.body == null) return options.headers;
  return { "content-type": "application/json", ...options.headers };
}
