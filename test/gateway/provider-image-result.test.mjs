import assert from "node:assert/strict";
import test from "node:test";

import { resolveProviderImage } from "../../src/gateway/provider-image-result.mjs";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8VwAAAABJRU5ErkJggg==",
  "base64",
);

const publicDns = async () => [{ address: "203.1.2.3", family: 4 }];

test("resolves the documented b64_json response into verified image bytes", async () => {
  const result = await resolveProviderImage({ data: [{ b64_json: ONE_PIXEL_PNG.toString("base64") }] });

  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(result.imageBuffer, ONE_PIXEL_PNG);
});

test("resolves a provider HTTPS URL and verifies the downloaded image", async () => {
  const result = await resolveProviderImage(
    { data: [{ url: "https://cdn.example/generated.png" }] },
    {
      dnsLookup: publicDns,
      fetchImpl: async () => new Response(ONE_PIXEL_PNG, { status: 200, headers: { "content-type": "image/png" } }),
    },
  );

  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(result.imageBuffer, ONE_PIXEL_PNG);
});

test("resolves image_url aliases and Base64 aliases", async () => {
  const fromImageUrl = await resolveProviderImage(
    { image_url: "https://cdn.example/generated.png" },
    { dnsLookup: publicDns, fetchImpl: async () => new Response(ONE_PIXEL_PNG) },
  );
  const fromBase64 = await resolveProviderImage({ data: [{ image_base64: ONE_PIXEL_PNG.toString("base64") }] });

  assert.deepEqual(fromImageUrl.imageBuffer, ONE_PIXEL_PNG);
  assert.deepEqual(fromBase64.imageBuffer, ONE_PIXEL_PNG);
});

test("resolves image Data URLs", async () => {
  const result = await resolveProviderImage({ data: [{ image_url: `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}` }] });

  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(result.imageBuffer, ONE_PIXEL_PNG);
});

test("rejects HTTP and private-network image URLs", async () => {
  await assert.rejects(
    () => resolveProviderImage({ data: [{ url: "http://cdn.example/generated.png" }] }),
    (error) => error.code === "provider_image_url_invalid",
  );
  await assert.rejects(
    () => resolveProviderImage(
      { data: [{ url: "https://cdn.example/generated.png" }] },
      { dnsLookup: async () => [{ address: "10.0.0.7", family: 4 }] },
    ),
    (error) => error.code === "provider_image_url_blocked",
  );
});

test("rejects a redirect that changes to a private-network image URL", async () => {
  let calls = 0;
  await assert.rejects(
    () => resolveProviderImage(
      { data: [{ url: "https://cdn.example/generated.png" }] },
      {
        dnsLookup: async (host) => host === "private.example" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "203.1.2.3", family: 4 }],
        fetchImpl: async () => {
          calls += 1;
          return new Response(null, { status: 302, headers: { location: "https://private.example/image.png" } });
        },
      },
    ),
    (error) => error.code === "provider_image_url_blocked",
  );
  assert.equal(calls, 1);
});

test("rejects oversized and non-image URL responses", async () => {
  await assert.rejects(
    () => resolveProviderImage(
      { data: [{ url: "https://cdn.example/generated.png" }] },
      { dnsLookup: publicDns, fetchImpl: async () => new Response("too large", { headers: { "content-length": String(25 * 1024 * 1024 + 1) } }) },
    ),
    (error) => error.code === "provider_image_too_large",
  );
  await assert.rejects(
    () => resolveProviderImage(
      { data: [{ url: "https://cdn.example/generated.png" }] },
      { dnsLookup: publicDns, fetchImpl: async () => new Response("not an image") },
    ),
    (error) => error.code === "provider_image_invalid",
  );
});

test("reports only response shape when a 200 payload has no supported image result", async () => {
  await assert.rejects(
    () => resolveProviderImage({ created: 1, data: [{ message: "not an image", code: "upstream_shape_changed" }] }),
    (error) => error.code === "provider_protocol_error"
      && error.diagnostic.topLevelKeys.join(",") === "created,data"
      && error.diagnostic.dataItemKeys.join(",") === "message,code",
  );
});

test("rejects an IPv6 loopback image URL", async () => {
  await assert.rejects(
    () => resolveProviderImage({ data: [{ url: "https://[::1]/generated.png" }] }),
    (error) => error.code === "provider_image_url_blocked",
  );
});
test("reports a safe provider error when an image URL cannot be resolved", async () => {
  await assert.rejects(
    () => resolveProviderImage(
      { data: [{ url: "https://missing.example/generated.png" }] },
      { dnsLookup: async () => { throw new Error("ENOTFOUND missing.example"); } },
    ),
    (error) => error.code === "provider_image_url_blocked",
  );
});