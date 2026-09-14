import COS from "cos-nodejs-sdk-v5";
import { randomUUID } from "node:crypto";
import { resolveProviderImage } from "./provider-image-result.mjs";

const extensionFor = (mimeType) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mimeType] || "png");

export function createReferenceStore({ secretId, secretKey, bucket, region, prefix = "workbuddy-reference-images", cos = new COS({ SecretId: secretId, SecretKey: secretKey }) }) {
  const call = (name, args) => new Promise((resolve, reject) => cos[name](args, (error, data) => error ? reject(error) : resolve(data)));
  const signedUrl = (key, expires) => new Promise((resolve, reject) => cos.getObjectUrl({ Bucket: bucket, Region: region, Key: key, Sign: true, Expires: expires }, (error, result) => error ? reject(error) : resolve(result?.Url || result)));

  return {
    async put({ buffer, mimeType, fileName, requestId }) {
      const ext = ((fileName || "reference.png").split(".").pop() || "png").replace(/[^a-z0-9]/gi, "");
      const key = `${prefix}/${requestId || randomUUID()}.${ext}`;
      await call("putObject", { Bucket: bucket, Region: region, Key: key, Body: buffer, ContentType: mimeType, ContentLength: buffer.length, ACL: "private" });
      return { key, publicUrl: await signedUrl(key, 600) };
    },
    async putReference(input) {
      const result = await this.put(input);
      return { objectKey: result.key };
    },
    async putGenerated({ buffer, mimeType, requestId }) {
      const key = `${prefix}/generated/${requestId}.${extensionFor(mimeType)}`;
      await call("putObject", { Bucket: bucket, Region: region, Key: key, Body: buffer, ContentType: mimeType, ContentLength: buffer.length, ACL: "private" });
      return { objectKey: key, mimeType, imageUrl: await signedUrl(key, 86400), expiresAt: new Date(Date.now() + 86400 * 1000).toISOString() };
    },
    async putGeneratedFromUrl({ url, requestId }) {
      const image = await resolveProviderImage({ data: [{ url }] });
      return this.putGenerated({ ...image, buffer: image.imageBuffer, requestId });
    },
    async findGenerated(requestId) {
      for (const [extension, mimeType] of [["png", "image/png"], ["jpg", "image/jpeg"], ["webp", "image/webp"]]) {
        const objectKey = `${prefix}/generated/${requestId}.${extension}`;
        try {
          await call("headObject", { Bucket: bucket, Region: region, Key: objectKey });
          return { objectKey, mimeType };
        } catch (error) {
          if (error?.statusCode !== 404 && error?.code !== "NoSuchKey") throw error;
        }
      }
      return null;
    },
    async exists(key) {
      try { await call("headObject", { Bucket: bucket, Region: region, Key: key }); return true; }
      catch (error) { if (error?.statusCode === 404 || error?.code === "NoSuchKey") return false; throw error; }
    },
    async getReference(key) {
      const result = await call("getObject", { Bucket: bucket, Region: region, Key: key });
      return { buffer: Buffer.from(result.Body), mimeType: result.headers?.["content-type"] || "application/octet-stream", fileName: key.split("/").at(-1) };
    },
    getSignedOutput: (key, expires = 600) => signedUrl(key, expires),
    remove: (key) => call("deleteObject", { Bucket: bucket, Region: region, Key: key })
  };
}
