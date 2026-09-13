import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { inspectImage } from "./inspect-image.mjs";

export function createProbeServer() {
  const server = new McpServer({
    name: "workbuddy-image-probe",
    version: "0.1.0",
  });

  server.registerTool(
    "probe_local_image",
    {
      title: "Probe local reference image",
      description:
        "Read a local PNG, JPEG, or WebP reference image and return only safe metadata. Use this to verify that a local image path can reach an MCP tool.",
      inputSchema: {
        image_path: z.string().min(1).describe("Absolute path of the local reference image"),
      },
    },
    async ({ image_path: imagePath }) => {
      try {
        const result = await inspectImage(imagePath);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to inspect image";
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  );

  return server;
}
