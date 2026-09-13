import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProviderError, createProviderUnreachableError } from "../../src/gateway/provider-error.mjs";

const messages = {
  policy: "\u6b64\u6b21\u751f\u6210\u56e0\u7248\u6743\u6216\u5185\u5bb9\u5b89\u5168\u9650\u5236\u88ab\u62d2\u7edd\uff0c\u8bf7\u4fee\u6539\u63d0\u793a\u8bcd\u6216\u66f4\u6362\u53c2\u8003\u56fe\u540e\u91cd\u8bd5\u3002",
  credits: "\u56fe\u50cf\u670d\u52a1\u4f59\u989d\u6216\u989d\u5ea6\u4e0d\u8db3\uff0c\u8bf7\u8054\u7cfb\u670d\u52a1\u7ba1\u7406\u5458\u68c0\u67e5\u8d26\u6237\u4f59\u989d\u6216\u5145\u503c\u3002",
  rate: "\u56fe\u50cf\u670d\u52a1\u5f53\u524d\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
  auth: "\u56fe\u50cf\u670d\u52a1\u7684\u8d26\u6237\u6388\u6743\u5f02\u5e38\uff0c\u8bf7\u8054\u7cfb\u670d\u52a1\u7ba1\u7406\u5458\u68c0\u67e5\u670d\u52a1\u7aef\u914d\u7f6e\u3002",
  invalid: "\u751f\u6210\u53c2\u6570\u4e0d\u7b26\u5408\u56fe\u50cf\u670d\u52a1\u8981\u6c42\uff0c\u8bf7\u68c0\u67e5\u63d0\u793a\u8bcd\u3001\u6bd4\u4f8b\u3001\u683c\u5f0f\u6216\u53c2\u8003\u56fe\u540e\u91cd\u8bd5\u3002",
  unavailable: "\u56fe\u50cf\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
  unknown: "\u56fe\u50cf\u670d\u52a1\u8fd4\u56de\u4e86\u672a\u8bc6\u522b\u7684\u9519\u8bef\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\uff1b\u82e5\u6301\u7eed\u51fa\u73b0\u8bf7\u8054\u7cfb\u670d\u52a1\u7ba1\u7406\u5458\u3002"
};

const cases = [
  { name: "copyright and content-policy responses", status: 400, body: { error: { code: "copyright_violation", type: "content_policy", message: "copyrighted character in prompt" } }, expected: { code: "content_policy_violation", message: messages.policy, httpStatus: 400, retryable: false } },
  { name: "insufficient balance responses", status: 402, body: { error: { code: "insufficient_credits", type: "billing", message: "balance is insufficient" } }, expected: { code: "provider_insufficient_credits", message: messages.credits, httpStatus: 402, retryable: false } },
  { name: "rate-limit responses", status: 429, body: { error: { code: "too_many_requests", message: "rate limit exceeded" } }, expected: { code: "provider_rate_limited", message: messages.rate, httpStatus: 429, retryable: true } },
  { name: "provider authorization responses", status: 401, body: { error: { code: "invalid_api_key", message: "bad token" } }, expected: { code: "provider_auth_failed", message: messages.auth, httpStatus: 502, retryable: false } },
  { name: "invalid request responses", status: 422, body: { error: { code: "invalid_size", message: "unsupported image size" } }, expected: { code: "provider_invalid_request", message: messages.invalid, httpStatus: 400, retryable: false } },
  { name: "provider availability responses", status: 503, body: { error: { code: "maintenance", message: "temporarily unavailable" } }, expected: { code: "provider_unavailable", message: messages.unavailable, httpStatus: 502, retryable: true } },
  { name: "unknown non-JSON-like responses", status: 418, body: {}, expected: { code: "provider_error", message: messages.unknown, httpStatus: 502, retryable: false } }
];

for (const sample of cases) {
  test(`normalizes ${sample.name} without exposing the upstream message`, () => {
    const error = normalizeProviderError({ provider: "gpt_ge", status: sample.status, body: sample.body });
    assert.deepEqual({ code: error.code, message: error.message, httpStatus: error.httpStatus, retryable: error.retryable }, sample.expected);
    const expectedDiagnostic = { provider: "gpt_ge", upstreamStatus: sample.status, category: sample.expected.code };
    if (sample.body.error?.code !== undefined) expectedDiagnostic.upstreamCode = sample.body.error.code;
    if (sample.body.error?.type !== undefined) expectedDiagnostic.upstreamType = sample.body.error.type;
    assert.deepEqual(error.diagnostic, expectedDiagnostic);
    assert.equal(JSON.stringify(error).includes(sample.body.error?.message || "secret"), false);
    assert.equal(error.message.includes(sample.body.error?.message || "secret"), false);
  });
}

test("normalizes a provider connection failure without leaking transport details", () => {
  const error = createProviderUnreachableError({ provider: "apimart", cause: new Error("token=secret prompt=private") });
  assert.deepEqual(
    { code: error.code, message: error.message, httpStatus: error.httpStatus, retryable: error.retryable, diagnostic: error.diagnostic },
    { code: "provider_unreachable", message: messages.unavailable, httpStatus: 502, retryable: true, diagnostic: { provider: "apimart", category: "provider_unreachable" } }
  );
});