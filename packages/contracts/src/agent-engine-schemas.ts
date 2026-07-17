import { z } from "zod";
import { type RuntimeDescriptor, runtimeDescriptorSchema } from "./agent-runtime-schemas";
import {
  type AgentTranscriptStreamPart,
  type AgentTranscriptUserMessageDisplayPart,
  agentSessionTodoItemSchema,
  agentStreamPartSchema,
  agentUserMessageDisplayPartSchema,
} from "./agent-session-event-schemas";
import {
  type AgentTranscriptModelSelection,
  agentModelSelectionSchema,
} from "./agent-session-schemas";
import { fileDiffSchema, fileStatusSchema } from "./git-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);

export type AgentModelAttachmentSupport = {
  image: boolean;
  audio: boolean;
  video: boolean;
  pdf: boolean;
  mimeTypes?: Partial<Record<"image" | "audio" | "video" | "pdf", string[]>>;
};

export type AgentModelDescriptor = {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  variants: string[];
  contextWindow?: number;
  outputLimit?: number;
  attachmentSupport?: AgentModelAttachmentSupport;
  liveSessionUpdates?: {
    profile?: boolean;
    variants?: string[];
  };
};

export type AgentDescriptor = {
  id?: string;
  label?: string;
  name?: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden?: boolean;
  native?: boolean;
  color?: string;
};

export type AgentModelCatalog = {
  runtime?: RuntimeDescriptor;
  models: AgentModelDescriptor[];
  defaultModelsByProvider: Record<string, string>;
  profiles?: AgentDescriptor[];
};

const inferredAgentModelAttachmentSupportSchema = z
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
export const agentModelAttachmentSupportSchema =
  inferredAgentModelAttachmentSupportSchema as unknown as z.ZodType<AgentModelAttachmentSupport>;

const inferredAgentModelDescriptorSchema = z
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
export const agentModelDescriptorSchema =
  inferredAgentModelDescriptorSchema as unknown as z.ZodType<AgentModelDescriptor>;

const inferredAgentDescriptorSchema = z
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
export const agentDescriptorSchema =
  inferredAgentDescriptorSchema as unknown as z.ZodType<AgentDescriptor>;

const inferredAgentModelCatalogSchema = z
  .object({
    runtime: runtimeDescriptorSchema.optional(),
    models: z.array(agentModelDescriptorSchema),
    defaultModelsByProvider: z.record(z.string(), z.string()),
    profiles: z.array(agentDescriptorSchema).optional(),
  })
  .strict();
export const agentModelCatalogSchema =
  inferredAgentModelCatalogSchema as unknown as z.ZodType<AgentModelCatalog>;

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

export type AgentSessionHistoryMessage =
  | {
      messageId: string;
      role: "user";
      timestamp: string;
      timestampIsApproximate?: true;
      text: string;
      displayParts: AgentTranscriptUserMessageDisplayPart[];
      state: "queued" | "read";
      model?: AgentTranscriptModelSelection;
      parts: AgentTranscriptStreamPart[];
    }
  | {
      messageId: string;
      role: "assistant";
      timestamp: string;
      timestampIsApproximate?: true;
      text: string;
      durationMs?: number;
      totalTokens?: number;
      contextWindow?: number;
      model?: AgentTranscriptModelSelection;
      parts: AgentTranscriptStreamPart[];
    }
  | {
      messageId: string;
      role: "system";
      timestamp: string;
      timestampIsApproximate?: true;
      text: string;
      notice?:
        | {
            tone: "info";
            reason: "session_compacted";
            title: string;
          }
        | {
            tone: "info";
            reason: "session_forked";
            title: string;
            parentExternalSessionId: string;
          };
      parts: [];
    };

const inferredAgentSessionHistoryMessageSchema = z.discriminatedUnion("role", [
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
export const agentSessionHistoryMessageSchema =
  inferredAgentSessionHistoryMessageSchema as unknown as z.ZodType<AgentSessionHistoryMessage>;

export const agentSessionHistorySchema = z.array(agentSessionHistoryMessageSchema);
export const agentSessionTodosSchema = z.array(agentSessionTodoItemSchema);
export const agentFileDiffsSchema = z.array(fileDiffSchema);
export const agentFileStatusesSchema = z.array(fileStatusSchema);
