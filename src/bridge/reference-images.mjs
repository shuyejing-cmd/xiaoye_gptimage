import { AppError } from "../shared/errors.mjs";

export const MAX_REFERENCE_IMAGES = 4;

export function normalizeReferenceImagePaths({ referenceImagePath, referenceImagePaths }) {
  if (referenceImagePath !== undefined && referenceImagePaths !== undefined) {
    throw new AppError({ code: "reference_images_ambiguous", message: "use either reference_image_path or reference_image_paths", httpStatus: 400 });
  }
  const paths = referenceImagePaths !== undefined ? referenceImagePaths : referenceImagePath !== undefined ? [referenceImagePath] : [];
  if (!Array.isArray(paths) || (referenceImagePaths !== undefined && paths.length === 0) || paths.some((path) => typeof path !== "string" || !path.trim())) {
    throw new AppError({ code: "invalid_reference_images", message: "reference image paths must be non-empty strings", httpStatus: 400 });
  }
  if (paths.length > MAX_REFERENCE_IMAGES) {
    throw new AppError({ code: "too_many_reference_images", message: "at most four reference images are allowed", httpStatus: 400 });
  }
  return paths;
}