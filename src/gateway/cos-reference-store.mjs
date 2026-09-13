import COS from "cos-nodejs-sdk-v5";

const extensionFor = (mimeType) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mimeType] || "png");

export function createReferenceStore({ secretId, secretKey, bucket, region, prefix = "workbuddy-reference-images", cos = new COS({ SecretId: secretId, SecretKey: secretKey }) }) {
  const call = (name, args) => new Promise((resolve, reject) => cos[name](args, (error, data) => error ? reject(error) : resolve(data)));
  const signedUrl = (key, expires) => new Promise((resolve, reject) => cos.getObjectUrl({ Bucket: bucket, Region: region, Key: key, Sign: true, Expires: expires }, (error, result) => error ? reject(error) : resolve(result?.Url || result)));

  return {
    async put({ buffer, mimeType, fileName, requestId }) {
      const ext = (fileName.split(".").pop() || "png").replace(/[^a-z0-9]/gi, "");
      const key = `${prefix}/${requestId}.${ext}`;
      await call("putObject", { Bucket: bucket, Region: region, Key: key, Body: buffer, ContentType: mimeType, ContentLength: buffer.length });
      return { key, publicUrl: await signedUrl(key, 600) };
    },
    async putGenerated({ buffer, mimeType, requestId }) {
      const key = `${prefix}/generated/${requestId}.${extensionFor(mimeType)}`;
      await call("putObject", { Bucket: bucket, Region: region, Key: key, Body: buffer, ContentType: mimeType, ContentLength: buffer.length });
      return { imageUrl: await signedUrl(key, 86400), expiresAt: new Date(Date.now() + 86400 * 1000).toISOString() };
    },
    remove: (key) => call("deleteObject", { Bucket: bucket, Region: region, Key: key })
  };
}