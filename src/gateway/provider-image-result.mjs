import { lookup as lookupDns } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "../shared/errors.mjs";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const JPEG_SIGNATURE = Buffer.from("ffd8ff", "hex");

function imageMimeType(buffer) {
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png";
  if (buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return "image/jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new AppError({ code: "provider_image_invalid", message: "provider result is not a supported image", httpStatus: 502 });
}

function asImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new AppError({ code: "provider_image_invalid", message: "provider returned an empty image", httpStatus: 502 });
  if (buffer.length > MAX_IMAGE_BYTES) throw new AppError({ code: "provider_image_too_large", message: "provider image exceeds the download limit", httpStatus: 502 });
  return { imageBuffer: buffer, mimeType: imageMimeType(buffer) };
}

function decodeBase64(value) {
  const encoded = value.replace(/\s/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new AppError({ code: "provider_image_invalid", message: "provider returned invalid image data", httpStatus: 502 });
  }
  return asImage(Buffer.from(encoded, "base64"));
}

function decodeDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
  if (!match) throw new AppError({ code: "provider_image_invalid", message: "provider returned invalid image data", httpStatus: 502 });
  return decodeBase64(match[2]);
}

function isPublicIpv4(address) {
  const [a, b, c] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIp(address) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPublicIp(normalized.slice(7));
  if (normalized === "::" || normalized === "::1") return false;
  if (/^(fc|fd|fe[89ab]|ff)/.test(normalized)) return false;
  if (normalized.startsWith("2001:db8:")) return false;
  return true;
}

async function validateUrl(value, dnsLookup) {
  let url;
  try { url = new URL(value); } catch { throw new AppError({ code: "provider_image_url_invalid", message: "provider returned an invalid image URL", httpStatus: 502 }); }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new AppError({ code: "provider_image_url_invalid", message: "provider returned a disallowed image URL", httpStatus: 502 });
  }
  let addresses;
  try {
    addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await dnsLookup(url.hostname);
  } catch (cause) {
    throw new AppError({ code: "provider_image_url_blocked", message: "provider image URL does not resolve to a public address", httpStatus: 502, cause });
  }
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new AppError({ code: "provider_image_url_blocked", message: "provider image URL does not resolve to a public address", httpStatus: 502 });
  }
  return url;
}

async function readBody(response) {
  const expectedSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(expectedSize) && expectedSize > MAX_IMAGE_BYTES) throw new AppError({ code: "provider_image_too_large", message: "provider image exceeds the download limit", httpStatus: 502 });
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new AppError({ code: "provider_image_too_large", message: "provider image exceeds the download limit", httpStatus: 502 });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

async function downloadImage(value, { fetchImpl, dnsLookup }) {
  let url = await validateUrl(value, dnsLookup);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response;
    try {
      response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    } catch (cause) {
      throw new AppError({ code: "provider_image_download_failed", message: "provider image could not be downloaded", httpStatus: 502, cause });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new AppError({ code: "provider_image_url_invalid", message: "provider returned an invalid image redirect", httpStatus: 502 });
      url = await validateUrl(new URL(location, url).toString(), dnsLookup);
      continue;
    }
    if (!response.ok) throw new AppError({ code: "provider_image_download_failed", message: "provider image download failed", httpStatus: 502 });
    return asImage(await readBody(response));
  }
  throw new AppError({ code: "provider_image_url_invalid", message: "provider returned too many image redirects", httpStatus: 502 });
}

function responseShape(body) {
  const first = Array.isArray(body?.data) && body.data[0] && typeof body.data[0] === "object" ? body.data[0] : {};
  return {
    topLevelKeys: body && typeof body === "object" ? Object.keys(body) : [],
    dataItemKeys: Object.keys(first),
  };
}

function protocolError(body) {
  const error = new AppError({ code: "provider_protocol_error", message: "provider returned no supported image result", httpStatus: 502 });
  error.diagnostic = responseShape(body);
  return error;
}

export async function resolveProviderImage(body, { fetchImpl = fetch, dnsLookup = (host) => lookupDns(host, { all: true, verbatim: true }) } = {}) {
  const item = Array.isArray(body?.data) ? body.data[0] : undefined;
  const candidates = [item?.b64_json, item?.url, item?.image_url, body?.image_url, item?.base64, item?.image_base64];
  for (const value of candidates) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (value.startsWith("data:")) return decodeDataUrl(value);
    if (/^https?:\/\//i.test(value)) return downloadImage(value, { fetchImpl, dnsLookup });
    return decodeBase64(value);
  }
  throw protocolError(body);
}