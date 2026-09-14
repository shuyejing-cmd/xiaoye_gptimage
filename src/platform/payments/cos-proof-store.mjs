import { createHash } from "node:crypto";

const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function createCosProofStore({ bucket, region, prefix = "private/payment-proofs", cos }) {
  const call = (name, args) => new Promise((resolve, reject) => cos[name](args, (error, data) => error ? reject(error) : resolve(data)));
  return {
    async put({ orderNo, buffer, mimeType }) {
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const objectKey = `${prefix}/${String(orderNo).replace(/[^A-Za-z0-9_-]/g, "")}/${sha256}.${extensions[mimeType] || "bin"}`;
      await call("putObject", { Bucket: bucket, Region: region, Key: objectKey, Body: buffer, ContentType: mimeType, ContentLength: buffer.length, ACL: "private" });
      return { objectKey, sha256 };
    },
    signedUrl(objectKey, expires = 300) {
      return new Promise((resolve, reject) => cos.getObjectUrl({ Bucket: bucket, Region: region, Key: objectKey, Sign: true, Expires: expires }, (error, result) => error ? reject(error) : resolve(result?.Url || result)));
    }
  };
}
