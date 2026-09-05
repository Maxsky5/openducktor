import { z } from "zod";
import { agentSessionLiveRefSchema } from "./agent-session-schemas";
import {
  LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT,
  LOCAL_ATTACHMENT_BYTE_LIMIT,
} from "./attachment-limits";

export const agentGeneratedImageOutputSchema = z
  .object({
    representation: z.enum(["saved_file", "inline"]),
    itemId: z.string().min(1),
  })
  .strict();

export const agentImageGenerationPartSchema = z
  .object({
    kind: z.literal("image_generation"),
    messageId: z.string(),
    partId: z.string(),
    itemId: z.string().min(1),
    turnId: z.string().optional(),
    status: z.enum(["running", "completed", "failed", "interrupted", "incomplete"]),
    revisedPrompt: z.string().optional(),
    transparentBackground: z.boolean().optional(),
    savedPath: z.string().optional(),
    failure: z
      .object({
        kind: z.enum(["generation_failed", "usage_limit"]),
        message: z.string(),
        limitId: z.string().optional(),
        resetsAtEpochSeconds: z.number().int().optional(),
      })
      .strict()
      .optional(),
    incompleteReason: z
      .enum(["unknown_status", "incomplete_history", "turn_ended", "runtime_failure"])
      .optional(),
    output: agentGeneratedImageOutputSchema.optional(),
  })
  .strict()
  .superRefine((part, context) => {
    if (part.output && (part.status !== "completed" || part.output.itemId !== part.itemId)) {
      context.addIssue({
        code: "custom",
        path: ["output"],
        message: "Image output requires a completed item with matching identity.",
      });
    }
    if (part.failure && part.status !== "failed") {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Generation failure requires a failed item.",
      });
    }
    if (part.incompleteReason && part.status !== "incomplete") {
      context.addIssue({
        code: "custom",
        path: ["incompleteReason"],
        message: "An incomplete reason requires an incomplete item.",
      });
    }
  });
export type AgentImageGenerationPart = z.infer<typeof agentImageGenerationPartSchema>;

export const agentGeneratedImageReadInputSchema = z
  .object({
    ref: agentSessionLiveRefSchema,
    itemId: z.string().min(1),
    turnId: z.string().optional(),
  })
  .strict();
export type AgentGeneratedImageReadInput = z.infer<typeof agentGeneratedImageReadInputSchema>;

export const agentGeneratedImageReadResultSchema = agentGeneratedImageReadInputSchema
  .extend({
    mime: z.literal("image/png"),
    byteLength: z.number().int().positive().max(LOCAL_ATTACHMENT_BYTE_LIMIT),
    base64: z.string().min(1).max(LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT),
  })
  .strict();
export type AgentGeneratedImageReadResult = z.infer<typeof agentGeneratedImageReadResultSchema>;
