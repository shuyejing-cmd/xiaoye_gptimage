import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { parseGenerationRequest } from "../shared/contracts.mjs";
import { AppError } from "../shared/errors.mjs";
import { attachRemoteMcp } from "./remote-mcp-server.mjs";

export function createApp({ gatewayToken, generationService }) {
  const app = Fastify();
  const auth = (request) => { if (request.headers.authorization !== `Bearer ${gatewayToken}`) throw new AppError({ code: "unauthorized", message: "Unauthorized", httpStatus: 401 }); };
  app.register(multipart, { limits: { files: 4, fileSize: 4 * 1024 * 1024, parts: 10 } });
  app.get("/healthz", async () => ({ status: "ok" }));
  app.post("/v1/bridge/generations", async (request) => {
    auth(request);
    let input = request.body;
    const referenceImages = [];
    if (request.isMultipart()) {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === "file") {
          if (part.fieldname !== "image") throw new AppError({ code: "invalid_reference_field", message: "reference image field must be image", httpStatus: 400 });
          const chunks = [];
          for await (const chunk of part.file) chunks.push(chunk);
          referenceImages.push({ buffer: Buffer.concat(chunks), mimeType: part.mimetype, fileName: part.filename });
        } else if (part.fieldname === "request") input = JSON.parse(part.value);
      }
    }
    const result = await generationService.generate({ request: parseGenerationRequest(input), referenceImages: referenceImages.length ? referenceImages : undefined });
    return { request_id: result.requestId, status: result.status, image_url: result.imageUrl, expires_at: result.expiresAt };
  });
  attachRemoteMcp(app, { gatewayToken, generationService });
  app.setErrorHandler((error, request, reply) => {
    const x = error instanceof AppError ? error : error?.code === "FST_FILES_LIMIT"
      ? new AppError({ code: "too_many_reference_images", message: "at most four reference images are allowed", httpStatus: 400 })
      : error?.code === "FST_REQ_FILE_TOO_LARGE"
        ? new AppError({ code: "reference_image_too_large", message: "each reference image cannot exceed 4 MiB", httpStatus: 400 })
        : new AppError({ code: "internal_error", message: "Service temporarily unavailable", httpStatus: 500 });
    reply.code(x.httpStatus).send({ error: { code: x.code, message: x.message } });
  });
  return app;
}