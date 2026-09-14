import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function createPayloadCipher({ key, random = randomBytes }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("payload encryption key must be exactly 32 bytes");
  return {
    encrypt(value) {
      const iv = random(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
    },
    decrypt(encoded) {
      const [version, iv, tag, ciphertext] = String(encoded).split(".");
      if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("invalid encrypted payload");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"));
    }
  };
}
