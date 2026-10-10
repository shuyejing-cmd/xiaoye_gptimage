import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseGenerationRequest } from "../shared/contracts.mjs";
import { readValidatedReferenceImages } from "./image-file.mjs";
import { normalizeReferenceImagePaths } from "./reference-images.mjs";

export function createBridgeServer({ allowedRoots, gatewayClient }) {
  const server = new McpServer({ name: "workbuddy-image-bridge", version: "0.1.0" });
  server.registerTool("generate_image", {
    description: "Generate one image. Default 2K costs 2 points; 1K costs 2 and 4K costs 3. References do not add points. Text uses Flare and reference editing uses Sunburst. Use get_balance for current prices. Pass one to four local reference_image_paths; reference_image_path remains supported. Omit quality and output_format (legacy medium/png accepted).",
    inputSchema: {
      prompt: z.string().min(1),
      reference_image_path: z.string().optional(),
      reference_image_paths: z.array(z.string()).min(1).max(4).optional(),
      size: z.string().optional(), resolution: z.string().optional(), quality: z.string().optional(), output_format: z.string().optional()
    }
  }, async (args) => {
    try {
      const { reference_image_path: referenceImagePath, reference_image_paths: referenceImagePaths, ...input } = args;
      const request = parseGenerationRequest(input);
      const paths = normalizeReferenceImagePaths({ referenceImagePath, referenceImagePaths });
      const output = paths.length
        ? await gatewayClient.generateWithReferences(request, await readValidatedReferenceImages({ imagePaths: paths, allowedRoots }))
        : await gatewayClient.generateText(request);
      return { content: [{ type: "text", text: JSON.stringify(output) }] };
    } catch (error) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : "generation failed" }], isError: true };
    }
  });
  server.registerTool("get_generation", {
    description: "Get the current status and result for an earlier image generation request.",
    inputSchema: { request_id: z.string().min(1) }
  }, async ({ request_id: requestId }) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await gatewayClient.getGeneration(requestId)) }] };
    } catch (error) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : "lookup failed" }], isError: true };
    }
  });
  server.registerTool("get_balance", {
    description: "Get available and held points, the current server price table, and generation defaults.",
    inputSchema: {}
  }, async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await gatewayClient.getBalance()) }] };
    } catch (error) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : "balance lookup failed" }], isError: true };
    }
  });
  return server;
}
