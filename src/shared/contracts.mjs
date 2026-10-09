import { z } from "zod";

export const SUPPORTED_SIZES = [
  "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5",
  "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9"
];

export const generationRequestSchema = z.object({
  prompt: z.string().trim().min(1, "prompt 不能为空").max(3000, "prompt 不能超过 3000 字符"),
  size: z.enum(SUPPORTED_SIZES).default("1:1"),
  resolution: z.enum(["auto", "1k", "2k", "4k"]).default("2k"),
  quality: z.enum(["auto", "low", "medium", "high"]).default("medium"),
  output_format: z.enum(["png", "jpeg", "webp"]).default("png"),
  n: z.literal(1).default(1)
}).strict();

export function parseGenerationRequest(input) {
  return generationRequestSchema.parse(input);
}
