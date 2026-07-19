import { z } from "zod";
import { runtimeDescriptorSchema } from "./agent-runtime-schemas";
import {
  agentSessionTodoItemSchema,
  agentStreamPartSchema,
  agentUserMessageDisplayPartSchema,
} from "./agent-session-event-schemas";
import { agentModelSelectionSchema } from "./agent-session-schemas";
import { fileDiffSchema, fileStatusSchema } from "./git-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);

export const agentModelAttachmentSupportSchema = z
  .object({
    image: z.boolean(),
    audio: z.boolean(),
    video: z.boolean(),
    pdf: z.boolean(),
    mimeTypes: z
      .object({
        image: z.array(nonEmptyStringSchema).optional(),
        audio: z.array(nonEmptyStringSchema).optional(),
        video: z.array(nonEmptyStringSchema).optional(),
        pdf: z.array(nonEmptyStringSchema).optional(),
      })
      .optional(),
  })
  .strict();
export type AgentModelAttachmentSupport = z.infer<typeof agentModelAttachmentSupportSchema>;

export const agentModelDescriptorSchema = z
  .object({
    id: nonEmptyStringSchema,
    providerId: nonEmptyStringSchema,
    providerName: nonEmptyStringSchema,
    modelId: nonEmptyStringSchema,
    modelName: nonEmptyStringSchema,
    variants: z.array(z.string()),
    contextWindow: z.number().int().positive().optional(),
    outputLimit: z.number().int().positive().optional(),
    attachmentSupport: agentModelAttachmentSupportSchema.optional(),
    liveSessionUpdates: z
      .object({
        profile: z.boolean().optional(),
        variants: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AgentModelDescriptor = z.infer<typeof agentModelDescriptorSchema>;

export const agentDescriptorSchema = z
  .object({
    id: nonEmptyStringSchema.optional(),
    label: nonEmptyStringSchema.optional(),
    name: nonEmptyStringSchema.optional(),
    description: z.string().optional(),
    mode: z.enum(["subagent", "primary", "all"]),
    hidden: z.boolean().optional(),
    native: z.boolean().optional(),
    color: nonEmptyStringSchema.optional(),
  })
  .strict();
export type AgentDescriptor = z.infer<typeof agentDescriptorSchema>;

export const agentModelCatalogSchema = z
  .object({
    runtime: runtimeDescriptorSchema.optional(),
    models: z.array(agentModelDescriptorSchema),
    defaultModelsByProvider: z.record(z.string(), z.string()),
    profiles: z.array(agentDescriptorSchema).optional(),
  })
  .strict();
export type AgentModelCatalog = z.infer<typeof agentModelCatalogSchema>;

const sessionHistoryNoticeSchema = z.discriminatedUnion("reason", [
  z
    .object({
      tone: z.literal("info"),
      reason: z.literal("session_compacted"),
      title: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      tone: z.literal("info"),
      reason: z.literal("session_forked"),
      title: nonEmptyStringSchema,
      parentExternalSessionId: nonEmptyStringSchema,
    })
    .strict(),
]);

const sessionHistoryMessageShape = {
  messageId: nonEmptyStringSchema,
  timestamp: nonEmptyStringSchema,
  timestampIsApproximate: z.literal(true).optional(),
  text: z.string(),
};

export const agentSessionHistoryMessageSchema = z.discriminatedUnion("role", [
  z
    .object({
      ...sessionHistoryMessageShape,
      role: z.literal("user"),
      displayParts: z.array(agentUserMessageDisplayPartSchema),
      state: z.enum(["queued", "read"]),
      model: agentModelSelectionSchema.optional(),
      parts: z.array(agentStreamPartSchema),
    })
    .strict(),
  z
    .object({
      ...sessionHistoryMessageShape,
      role: z.literal("assistant"),
      durationMs: z.number().optional(),
      totalTokens: z.number().optional(),
      contextWindow: z.number().optional(),
      model: agentModelSelectionSchema.optional(),
      parts: z.array(agentStreamPartSchema),
    })
    .strict(),
  z
    .object({
      ...sessionHistoryMessageShape,
      role: z.literal("system"),
      notice: sessionHistoryNoticeSchema.optional(),
      parts: z.tuple([]),
    })
    .strict(),
]);
export type AgentSessionHistoryMessage = z.infer<typeof agentSessionHistoryMessageSchema>;

export const agentSessionHistorySchema = z.array(agentSessionHistoryMessageSchema);
export const agentSessionTodosSchema = z.array(agentSessionTodoItemSchema);
export const agentFileDiffsSchema = z.array(fileDiffSchema);
export const agentFileStatusesSchema = z.array(fileStatusSchema);
