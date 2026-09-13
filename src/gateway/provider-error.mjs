import { AppError } from "../shared/errors.mjs";

const MESSAGES = {
  content_policy_violation: "\u6b64\u6b21\u751f\u6210\u56e0\u7248\u6743\u6216\u5185\u5bb9\u5b89\u5168\u9650\u5236\u88ab\u62d2\u7edd\uff0c\u8bf7\u4fee\u6539\u63d0\u793a\u8bcd\u6216\u66f4\u6362\u53c2\u8003\u56fe\u540e\u91cd\u8bd5\u3002",
  provider_insufficient_credits: "\u56fe\u50cf\u670d\u52a1\u4f59\u989d\u6216\u989d\u5ea6\u4e0d\u8db3\uff0c\u8bf7\u8054\u7cfb\u670d\u52a1\u7ba1\u7406\u5458\u68c0\u67e5\u8d26\u6237\u4f59\u989d\u6216\u5145\u503c\u3002",
  provider_rate_limited: "\u56fe\u50cf\u670d\u52a1\u5f53\u524d\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
  provider_auth_failed: "\u56fe\u50cf\u670d\u52a1\u7684\u8d26\u6237\u6388\u6743\u5f02\u5e38\uff0c\u8bf7\u8054\u7cfb\u670d\u52a1\u7ba1\u7406\u5458\u68c0\u67e5\u670d\u52a1\u7aef\u914d\u7f6e\u3002",
  provider_invalid_request: "\u751f\u6210\u53c2\u6570\u4e0d\u7b26\u5408\u56fe\u50cf\u670d\u52a1\u8981\u6c42\uff0c\u8bf7\u68c0\u67e5\u63d0\u793a\u8bcd\u3001\u6bd4\u4f8b\u3001\u683c\u5f0f\u6216\u53c2\u8003\u56fe\u540e\u91cd\u8bd5\u3002",
  provider_unavailable: "\u56fe\u50cf\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
  provider_unreachable: "\u56fe\u50cf\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
  provider_error: "\u56fe\u50cf\u670d\u52a1\u8fd4\u56de\u4e86\u672a\u8bc6\u522b\u7684\u9519\u8bef\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\uff1b\u82e5\u6301\u7eed\u51fa\u73b0\u8bf7\u8054\u7cfb\u670d\u52a1\u7ba1\u7406\u5458\u3002"
};

const includesAny = (value, markers) => markers.some((marker) => value.includes(marker));

function fields(body) {
  const error = body && typeof body === "object" && body.error && typeof body.error === "object" ? body.error : {};
  const code = typeof error.code === "string" ? error.code : typeof body?.code === "string" ? body.code : undefined;
  const type = typeof error.type === "string" ? error.type : typeof body?.type === "string" ? body.type : undefined;
  const message = typeof error.message === "string" ? error.message : typeof body?.message === "string" ? body.message : undefined;
  return { code, type, message, searchable: [code, type, message].filter(Boolean).join(" ").toLowerCase() };
}

function categoryFor({ status, searchable }) {
  if (includesAny(searchable, ["copyright", "content_policy", "content policy", "safety", "moderation", "sensitive", "policy_violation", "\u7248\u6743", "\u5185\u5bb9\u5b89\u5168", "\u5ba1\u6838", "\u654f\u611f"])) return "content_policy_violation";
  if (includesAny(searchable, ["insufficient_credit", "insufficient credit", "insufficient_balance", "insufficient balance", "insufficient_fund", "balance", "credits", "quota", "\u4f59\u989d", "\u989d\u5ea6"])) return "provider_insufficient_credits";
  if (status === 429 || includesAny(searchable, ["rate_limit", "rate limit", "too_many_requests", "too many requests", "\u9891\u7387\u9650\u5236", "\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41"])) return "provider_rate_limited";
  if (status === 401 || status === 403 || includesAny(searchable, ["api_key", "api key", "unauthorized", "forbidden", "permission", "invalid_token", "\u8ba4\u8bc1", "\u6388\u6743", "\u6743\u9650"])) return "provider_auth_failed";
  if (status === 400 || status === 422 || includesAny(searchable, ["invalid_parameter", "invalid parameter", "invalid_size", "invalid size", "validation", "\u53c2\u6570", "\u5c3a\u5bf8", "\u683c\u5f0f"])) return "provider_invalid_request";
  if (status >= 500 || includesAny(searchable, ["maintenance", "temporarily unavailable", "timeout", "\u670d\u52a1\u7ef4\u62a4", "\u6682\u65f6\u4e0d\u53ef\u7528", "\u8d85\u65f6"])) return "provider_unavailable";
  return "provider_error";
}

function responseStatus(category) {
  if (category === "content_policy_violation" || category === "provider_invalid_request") return 400;
  if (category === "provider_insufficient_credits") return 402;
  if (category === "provider_rate_limited") return 429;
  return 502;
}

function retryable(category) {
  return category === "provider_rate_limited" || category === "provider_unavailable" || category === "provider_unreachable";
}

function withDiagnostic({ provider, category, upstreamStatus, upstreamCode, upstreamType, cause }) {
  const error = new AppError({ code: category, message: MESSAGES[category], httpStatus: responseStatus(category), retryable: retryable(category), cause });
  Object.defineProperty(error, "diagnostic", { value: { provider, ...(upstreamStatus === undefined ? {} : { upstreamStatus }), category, ...(upstreamCode === undefined ? {} : { upstreamCode }), ...(upstreamType === undefined ? {} : { upstreamType }) }, enumerable: false });
  return error;
}

export function normalizeProviderError({ provider, status, body }) {
  const upstream = fields(body);
  return withDiagnostic({ provider, category: categoryFor({ status, searchable: upstream.searchable }), upstreamStatus: status, upstreamCode: upstream.code, upstreamType: upstream.type });
}

export function createProviderUnreachableError({ provider, cause }) {
  return withDiagnostic({ provider, category: "provider_unreachable", cause });
}