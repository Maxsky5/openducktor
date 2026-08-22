import type {
  CanUseTool,
  HookInput,
  SDKMessage,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import type { JsonValue } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import { z } from "zod";

const claudeJsonValueSchema = z.json();

type ClaudeSdkUserMessage = Extract<SDKMessage, { type: "user" }>;

const claudeJsonRecordSchema = z.object({}).catchall(claudeJsonValueSchema);

const claudeToolHookSchema = z.object({
  agent_id: z.string().min(1).optional(),
  tool_input: claudeJsonRecordSchema,
  tool_name: z.string().min(1),
  tool_use_id: z.string().min(1),
});

const claudeContentBlockSchema = claudeJsonRecordSchema.extend({
  type: z.string().min(1),
});

const claudeUserMessagePayloadSchema = claudeJsonRecordSchema.extend({
  content: z.union([z.string(), z.array(claudeContentBlockSchema)]),
});

const claudeToolResultBlockSchema = z.discriminatedUnion("type", [
  claudeJsonRecordSchema.extend({
    tool_use_id: z.string().min(1),
    type: z.literal("tool_result"),
  }),
  claudeJsonRecordSchema.extend({
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

const claudeUserToolResultMessagePayloadSchema = claudeJsonRecordSchema.extend({
  content: z.union([z.string(), z.array(claudeUserToolResultContentBlockSchema)]),
});

const claudeUserTurnOriginSchema = claudeJsonRecordSchema.extend({
  kind: z.string().min(1),
});

const claudeStructuredToolUseResultSchema = claudeJsonRecordSchema.extend({
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

const claudeAssistantMessagePayloadSchema = claudeJsonRecordSchema.extend({
  content: z.array(claudeContentBlockSchema),
});

const claudeHistoryConversationEntrySchema = claudeJsonRecordSchema.extend({
  message: claudeUserMessagePayloadSchema,
});

const claudeHistoryAssistantEntrySchema = claudeJsonRecordSchema.extend({
  message: claudeAssistantMessagePayloadSchema,
});

const claudeHistoryAttachmentSchema = claudeJsonRecordSchema.extend({
  isMeta: z.boolean().optional(),
  prompt: z.string().optional(),
  timestamp: z.string().optional(),
  type: z.string().min(1),
});

const claudeHistoryAttachmentEntrySchema = claudeJsonRecordSchema.extend({
  attachment: claudeJsonValueSchema,
});

const claudeMetaQueuedCommandAttachmentSchema = claudeHistoryAttachmentSchema.extend({
  isMeta: z.literal(true),
  prompt: z.string().min(1),
  type: z.literal("queued_command"),
});

export const claudeHistoryStoreEntrySchema = claudeJsonRecordSchema.extend({
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
  tool_response: claudeJsonValueSchema,
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

export const claudeUserToolResultIngressSchema = claudeJsonRecordSchema.extend({
  message: claudeUserToolResultMessagePayloadSchema,
  origin: claudeUserTurnOriginSchema.optional(),
  parent_tool_use_id: z.string().min(1).nullable().optional(),
  shouldQuery: z.boolean().optional(),
  tool_use_result: claudeTopLevelToolUseResultSchema.optional(),
  type: z.literal("user"),
  uuid: z.string().optional(),
});

const parseClaudeIngress = <Schema extends z.ZodType, Input>(
  schema: Schema,
  value: Input,
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

export const parseClaudeHistoryConversationEntry = <Input>(value: Input) =>
  parseClaudeIngress(claudeHistoryConversationEntrySchema, value, "claudeHistoryMessage");

export const parseClaudeHistoryAssistantEntry = <Input>(value: Input) =>
  parseClaudeIngress(claudeHistoryAssistantEntrySchema, value, "claudeHistoryAssistantMessage");

export const parseClaudeHistoryAttachment = <Input>(value: Input) =>
  parseClaudeIngress(claudeHistoryAttachmentSchema, value, "claudeHistoryAttachment");

export const parseClaudeHistoryAttachmentEntry = <Input>(value: Input) =>
  parseClaudeIngress(claudeHistoryAttachmentEntrySchema, value, "claudeHistoryAttachmentEntry");

export const parseClaudeMetaQueuedCommandAttachment = <Input>(value: Input) =>
  parseClaudeIngress(
    claudeMetaQueuedCommandAttachmentSchema,
    value,
    "claudeMetaQueuedCommandAttachment",
  );

export const parseClaudePreToolUseIngress = (value: HookInput) =>
  parseClaudeIngress(claudePreToolUseIngressSchema, value, "claudePreToolUse");

export const parseClaudePostToolUseIngress = (value: HookInput): ClaudePostToolUseIngress =>
  parseClaudeIngress(claudePostToolUseIngressSchema, value, "claudePostToolUse");

export const parseClaudeFileEditToolResponse = <Input>(value: Input) =>
  parseClaudeIngress(claudeJsonRecordSchema, value, "claudeFileEditToolResponse");

export const parseClaudeJsonValue = <Input>(value: Input, field: string): JsonValue =>
  parseClaudeIngress(claudeJsonValueSchema, value, field);

export const parseClaudeJsonRecord = (
  value: Parameters<CanUseTool>[1],
  field: string,
): Record<string, JsonValue> => parseClaudeIngress(claudeJsonRecordSchema, value, field);

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
    ...(() => {
      if (message.parent_tool_use_id === undefined) {
        return {};
      }
      return { parent_tool_use_id: message.parent_tool_use_id };
    })(),
    ...(() => {
      if (message.shouldQuery === false || message.origin === undefined) {
        return {};
      }
      return { turnOriginKind: message.origin.kind };
    })(),
    ...(() => {
      if (message.uuid === undefined) {
        return {};
      }
      return { uuid: message.uuid };
    })(),
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
