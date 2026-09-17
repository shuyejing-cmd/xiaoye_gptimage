import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, sep } from "node:path";
import { AppError } from "../shared/errors.mjs";

const MAX_BYTES = 4 * 1024 * 1024;

function detectMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new AppError({ code: "unsupported_image", message: "unsupported image format", httpStatus: 400 });
}

export async function readValidatedReferenceImage({ imagePath, allowedRoots }) {
  const roots = await Promise.all(allowedRoots.map((root) => realpath(root)));
  const resolved = await realpath(imagePath);
  if (!roots.some((root) => resolved === root || resolved.startsWith(root + sep))) throw new AppError({ code: "image_path_not_allowed", message: "image path is not allowed", httpStatus: 400 });
  const meta = await lstat(resolved);
  if (!meta.isFile()) throw new AppError({ code: "invalid_image_path", message: "reference is not a file", httpStatus: 400 });
  if (meta.size > MAX_BYTES) throw new AppError({ code: "image_too_large", message: "each reference image cannot exceed 4 MiB", httpStatus: 400 });
  const buffer = await readFile(resolved);
  return { buffer, mimeType: detectMime(buffer), fileName: basename(resolved) };
}

export async function readValidatedReferenceImages({ imagePaths, allowedRoots }) {
  return Promise.all(imagePaths.map((imagePath) => readValidatedReferenceImage({ imagePath, allowedRoots })));
}