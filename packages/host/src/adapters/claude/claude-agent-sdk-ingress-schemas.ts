import type { HookInput, SDKMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { type JsonObject, jsonValueSchema } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import { z } from "zod";

const claudeUnknownValueSchema = z.unknown();

type ClaudeSdkUserMessage = Extract<SDKMessage, { type: "user" }>;

const claudeUnknownRecordSchema = z.object({}).catchall(claudeUnknownValueSchema);
const claudePlainUnknownRecordSchema = z.record(z.string(), claudeUnknownValueSchema);
const claudeCanonicalJsonObjectSchema = z.record(z.string(), jsonValueSchema);

const claudeToolHookSchema = z.object({
  agent_id: z.string().min(1).optional(),
  tool_input: claudeCanonicalJsonObjectSchema,
  tool_name: z.string().min(1),
  tool_use_id: z.string().min(1),
});

const claudeContentBlockSchema = claudeUnknownRecordSchema.extend({
  type: z.string().min(1),
});

const claudeUserMessagePayloadSchema = claudeUnknownRecordSchema.extend({
  content: z.union([z.string(), z.array(claudeContentBlockSchema)]),
});

const claudeToolResultBlockSchema = z.discriminatedUnion("type", [
  claudeUnknownRecordSchema.extend({
    tool_use_id: z.string().min(1),
    type: z.literal("tool_result"),
  }),
  claudeUnknownRecordSchema.extend({
    tool_use_id: z.string().min(1),
    type: z.literal("mcp_tool_result"),
  }),
]);

const claudeNonToolResultContentBlockSchema = claudeContentBlockSchema.extend({
  type: z
    .string()
    .min(1)
    .refine((type) => type !== "tool_result" && type !== "mcp_tool_result"),
});

const claudeUserToolResultContentBlockSchema = z.union([
  claudeToolResultBlockSchema.transform((raw) => ({ kind: "tool_result" as const, raw })),
  claudeNonToolResultContentBlockSchema.transform((raw) => ({ kind: "content" as const, raw })),
]);

const claudeUserToolResultMessagePayloadSchema = claudeUnknownRecordSchema.extend({
  content: z.union([z.string(), z.array(claudeUserToolResultContentBlockSchema)]),
});

const claudeUserTurnOriginSchema = claudeUnknownRecordSchema.extend({
  kind: z.string().min(1),
});

const claudeStructuredToolUseResultSchema = claudeUnknownRecordSchema.extend({
  type: z
    .string()
    .min(1)
    .refine((type) => type !== "tool_result" && type !== "mcp_tool_result")
    .optional(),
});

const claudeTopLevelToolUseResultSchema = z.union([
  claudeToolResultBlockSchema.transform((result) => ({ kind: "tool_result" as const, result })),
  claudeStructuredToolUseResultSchema.transform((structuredOutput) => ({
    kind: "structured_output" as const,
    structuredOutput,
  })),
]);

const claudeAssistantMessagePayloadSchema = claudeUnknownRecordSchema.extend({
  content: z.array(claudeContentBlockSchema),
});

const claudeHistoryConversationEntrySchema = claudeUnknownRecordSchema.extend({
  message: claudeUserMessagePayloadSchema,
});

const claudeHistoryAssistantEntrySchema = claudeUnknownRecordSchema.extend({
  message: claudeAssistantMessagePayloadSchema,
});

const claudeHistoryAttachmentSchema = claudeUnknownRecordSchema.extend({
  isMeta: z.boolean().optional(),
  prompt: z.string().optional(),
  timestamp: z.string().optional(),
  type: z.string().min(1),
});

const claudeHistoryAttachmentEntrySchema = claudeUnknownRecordSchema.extend({
  attachment: claudeUnknownValueSchema,
});

const claudeMetaQueuedCommandAttachmentSchema = claudeHistoryAttachmentSchema.extend({
  isMeta: z.literal(true),
  prompt: z.string().min(1),
  type: z.literal("queued_command"),
});

export const claudeHistoryStoreEntrySchema = claudeUnknownRecordSchema.extend({
  timestamp: z.string().optional(),
  type: z.string().min(1),
  uuid: z.string().optional(),
});

export const claudePreToolUseIngressSchema = claudeToolHookSchema.extend({
  hook_event_name: z.literal("PreToolUse"),
});

const claudePostToolUseSuccessIngressSchema = claudeToolHookSchema.extend({
  duration_ms: z.number().finite().nonnegative().optional(),
  hook_event_name: z.literal("PostToolUse"),
  tool_response: claudeUnknownValueSchema,
});

const claudePostToolUseFailureIngressSchema = claudeToolHookSchema.extend({
  duration_ms: z.number().finite().nonnegative().optional(),
  error: z.string(),
  hook_event_name: z.literal("PostToolUseFailure"),
});

export const claudePostToolUseIngressSchema = z.discriminatedUnion("hook_event_name", [
  claudePostToolUseSuccessIngressSchema,
  claudePostToolUseFailureIngressSchema,
]);

export const claudeUserToolResultIngressSchema = claudeUnknownRecordSchema.extend({
  message: claudeUserToolResultMessagePayloadSchema,
  origin: claudeUserTurnOriginSchema.optional(),
  parent_tool_use_id: z.string().min(1).nullable().optional(),
  shouldQuery: z.boolean().optional(),
  tool_use_result: claudeTopLevelToolUseResultSchema.optional(),
  type: z.literal("user"),
  uuid: z.string().optional(),
});

const parseClaudeIngress = <Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  field: string,
): z.output<Schema> => {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new HostValidationError({
    field,
    message: `Claude SDK sent an invalid ${field} payload.`,
    cause: parsed.error,
    details: {
      issues: parsed.error.issues.map((issue) => {
        const path = issue.path.join(".") || "payload";
        return `${path}: ${issue.message}`;
      }),
    },
  });
};

export type ClaudePostToolUseIngress = z.output<typeof claudePostToolUseIngressSchema>;
export type ClaudeToolResultIngress = {
  raw: z.output<typeof claudeToolResultBlockSchema>;
  structuredOutput?: z.output<typeof claudeStructuredToolUseResultSchema>;
};
export type ClaudeUserToolResultIngress = {
  message: z.output<typeof claudeUserToolResultMessagePayloadSchema>;
  parent_tool_use_id?: string | null;
  toolResults: ClaudeToolResultIngress[];
  turnOriginKind?: string;
  type: "user";
  uuid?: string;
};

export const parseClaudeHistoryStoreEntry = (value: SessionStoreEntry) =>
  parseClaudeIngress(claudeHistoryStoreEntrySchema, value, "claudeSessionHistoryEntry");

export const parseClaudeHistoryConversationEntry = (
  value: unknown,
): z.output<typeof claudeHistoryConversationEntrySchema> =>
  parseClaudeIngress(claudeHistoryConversationEntrySchema, value, "claudeHistoryMessage");

export const parseClaudeHistoryAssistantEntry = (
  value: unknown,
): z.output<typeof claudeHistoryAssistantEntrySchema> =>
  parseClaudeIngress(claudeHistoryAssistantEntrySchema, value, "claudeHistoryAssistantMessage");

export const parseClaudeHistoryAttachment = (
  value: unknown,
): z.output<typeof claudeHistoryAttachmentSchema> =>
  parseClaudeIngress(claudeHistoryAttachmentSchema, value, "claudeHistoryAttachment");

export const parseClaudeHistoryAttachmentEntry = (
  value: unknown,
): z.output<typeof claudeHistoryAttachmentEntrySchema> =>
  parseClaudeIngress(claudeHistoryAttachmentEntrySchema, value, "claudeHistoryAttachmentEntry");

export const parseClaudeMetaQueuedCommandAttachment = (
  value: unknown,
): z.output<typeof claudeMetaQueuedCommandAttachmentSchema> =>
  parseClaudeIngress(
    claudeMetaQueuedCommandAttachmentSchema,
    value,
    "claudeMetaQueuedCommandAttachment",
  );

export const parseClaudePreToolUseIngress = (value: HookInput) =>
  parseClaudeIngress(claudePreToolUseIngressSchema, value, "claudePreToolUse");

export const parseClaudePostToolUseIngress = (value: HookInput): ClaudePostToolUseIngress =>
  parseClaudeIngress(claudePostToolUseIngressSchema, value, "claudePostToolUse");

export const parseClaudeFileEditToolResponse = (
  value: unknown,
): z.output<typeof claudePlainUnknownRecordSchema> =>
  parseClaudeIngress(claudePlainUnknownRecordSchema, value, "claudeFileEditToolResponse");

export const parseClaudeCanonicalJsonObject = (value: unknown, field: string): JsonObject =>
  parseClaudeIngress(claudeCanonicalJsonObjectSchema, value, field);

export const parseClaudeUserToolResultIngress = (
  value: ClaudeSdkUserMessage,
): ClaudeUserToolResultIngress => {
  const message = parseClaudeIngress(
    claudeUserToolResultIngressSchema,
    value,
    "claudeUserToolResult",
  );
  const contentToolResults = Array.isArray(message.message.content)
    ? message.message.content.flatMap((block) => (block.kind === "tool_result" ? [block.raw] : []))
    : [];
  const normalizedMessage = {
    message: message.message,
    type: message.type,
    ...(message.parent_tool_use_id === undefined
      ? undefined
      : { parent_tool_use_id: message.parent_tool_use_id }),
    ...(message.shouldQuery === false || message.origin === undefined
      ? undefined
      : { turnOriginKind: message.origin.kind }),
    ...(message.uuid === undefined ? undefined : { uuid: message.uuid }),
  };
  const topLevelToolUseResult = message.tool_use_result;
  if (topLevelToolUseResult?.kind === "tool_result") {
    return {
      ...normalizedMessage,
      toolResults: [{ raw: topLevelToolUseResult.result }],
    };
  }
  if (topLevelToolUseResult?.kind === "structured_output") {
    if (contentToolResults.length === 0) {
      throw new HostValidationError({
        field: "claudeUserToolResult",
        message: "Claude SDK sent structured tool output without a correlated tool result.",
      });
    }
    return {
      ...normalizedMessage,
      toolResults: contentToolResults.map((raw) => ({
        raw,
        structuredOutput: topLevelToolUseResult.structuredOutput,
      })),
    };
  }
  return { ...normalizedMessage, toolResults: contentToolResults.map((raw) => ({ raw })) };
};
