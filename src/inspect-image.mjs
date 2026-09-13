import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const JPEG_SIGNATURE = Buffer.from("ffd8ff", "hex");

function detectMimeType(buffer) {
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return "image/png";
  }

  if (buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return "image/jpeg";
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  throw new Error("Unsupported image format. Only PNG, JPEG, and WebP are allowed.");
}

export async function inspectImage(imagePath) {
  const [metadata, content] = await Promise.all([stat(imagePath), readFile(imagePath)]);
  const mimeType = detectMimeType(content);

  return {
    exists: true,
    bytes: metadata.size,
    mimeType,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
