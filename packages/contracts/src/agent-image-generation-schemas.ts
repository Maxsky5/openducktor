import { z } from "zod";
import { withMaxUtf16Length } from "./string-schemas";
import { agentSessionLiveRefSchema } from "./agent-session-schemas";
import {
  LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT,
  LOCAL_ATTACHMENT_BYTE_LIMIT,
} from "./attachment-limits";

export const agentGeneratedImageOutputSchema = z
  .object({
    revision: z.string().min(1),
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
    previewUnavailableReason: z.string().min(1).optional(),
    failure: z
      .object({
        kind: z.enum(["generation_failed", "usage_limit"]),
        message: z.string(),
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
    if (part.output && part.status !== "completed") {
      context.addIssue({
        code: "custom",
        path: ["output"],
        message: "Image output requires a completed item.",
      });
    }
    if (part.previewUnavailableReason && (part.status !== "completed" || part.output)) {
      context.addIssue({
        code: "custom",
        path: ["previewUnavailableReason"],
        message: "Preview unavailability requires completed generation without available output.",
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

export const AGENT_GENERATED_IMAGE_BATCH_LIMIT = 8;
export const agentGeneratedImageIdentitySchema = z
  .object({
    itemId: z.string().min(1),
    turnId: z.string().optional(),
  })
  .strict();

export const agentGeneratedImageReadInputSchema = z
  .object({
    ref: agentSessionLiveRefSchema,
    itemId: z.string().min(1),
    turnId: z.string().optional(),
    revision: z.string().min(1),
    batchId: z.string().uuid().optional(),
  })
  .strict();
export type AgentGeneratedImageReadInput = z.infer<typeof agentGeneratedImageReadInputSchema>;

export const agentGeneratedImageReadResultSchema = agentGeneratedImageReadInputSchema
  .extend({
    mime: z.literal("image/png"),
    byteLength: z.number().int().positive().max(LOCAL_ATTACHMENT_BYTE_LIMIT),
    base64: withMaxUtf16Length(z.string().min(1), LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT),
  })
  .strict();
export type AgentGeneratedImageReadResult = z.infer<typeof agentGeneratedImageReadResultSchema>;

export const agentGeneratedImageBatchInputSchema = z
  .object({
    ref: agentSessionLiveRefSchema,
    images: z
      .array(agentGeneratedImageIdentitySchema.extend({ revision: z.string().min(1) }))
      .min(1)
      .max(AGENT_GENERATED_IMAGE_BATCH_LIMIT),
  })
  .strict();
export type AgentGeneratedImageBatchInput = z.infer<typeof agentGeneratedImageBatchInputSchema>;

export const agentGeneratedImageBatchSchema = z
  .object({
    ref: agentSessionLiveRefSchema,
    batchId: z.string().uuid(),
  })
  .strict();
export type AgentGeneratedImageBatch = z.infer<typeof agentGeneratedImageBatchSchema>;

export const agentGeneratedImageBatchResultSchema = agentGeneratedImageBatchSchema
  .extend({
    admittedImages: agentGeneratedImageBatchInputSchema.shape.images,
  })
  .strict();
export type AgentGeneratedImageBatchResult = z.infer<typeof agentGeneratedImageBatchResultSchema>;

export const agentGeneratedImageDescribeInputSchema = z
  .object({
    ref: agentSessionLiveRefSchema,
    images: z.array(agentGeneratedImageIdentitySchema).min(1).max(64),
  })
  .strict();
export type AgentGeneratedImageDescribeInput = z.infer<
  typeof agentGeneratedImageDescribeInputSchema
>;

export const agentGeneratedImageDescribeResultSchema = z
  .object({
    ref: agentSessionLiveRefSchema,
    images: z.array(agentImageGenerationPartSchema).max(64),
  })
  .strict();
export type AgentGeneratedImageDescribeResult = z.infer<
  typeof agentGeneratedImageDescribeResultSchema
>;
