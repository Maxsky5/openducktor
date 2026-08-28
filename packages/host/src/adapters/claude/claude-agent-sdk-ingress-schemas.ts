import type { HookInput, SDKMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import {
  exactOptionalSchema,
  type ExactOptional,
  type JsonObject,
  jsonObjectSchema,
} from "@openducktor/contracts";
import type { UUID } from "node:crypto";
import { HostValidationError } from "../../effect/host-errors";
import { z } from "zod";

const claudeUnknownValueSchema = z.unknown();

const claudeUnknownRecordSchema = z.object({}).catchall(claudeUnknownValueSchema);
const claudePlainUnknownRecordSchema = z.record(z.string(), claudeUnknownValueSchema);

const claudeToolHookSchema = z.object({
  agent_id: z.string().min(1).optional(),
  tool_input: jsonObjectSchema,
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

const claudeTaskUsageSchema = z.object({
  total_tokens: z.number(),
  tool_uses: z.number(),
  duration_ms: z.number(),
});

type ClaudeHistorySubagentSystemMessage = Extract<
  SDKMessage,
  {
    type: "system";
    subtype: "task_started" | "task_progress" | "task_updated" | "task_notification";
  }
>;

const uuidStringSchema = z.uuid();
const claudeMessageUuidSchema = z.custom<UUID>(
  (value) => uuidStringSchema.safeParse(value).success,
);

const claudeTaskMessageSchema = z.object({
  type: z.literal("system"),
  task_id: z.string(),
  uuid: claudeMessageUuidSchema,
  session_id: z.string(),
});

const claudeTaskStartedMessageSchema = claudeTaskMessageSchema.extend({
  subtype: z.literal("task_started"),
  tool_use_id: z.string().optional(),
  description: z.string(),
  subagent_type: z.string().optional(),
  task_type: z.string().optional(),
  workflow_name: z.string().optional(),
  prompt: z.string().optional(),
  skip_transcript: z.boolean().optional(),
});

const claudeTaskProgressMessageSchema = claudeTaskMessageSchema.extend({
  subtype: z.literal("task_progress"),
  tool_use_id: z.string().optional(),
  description: z.string(),
  subagent_type: z.string().optional(),
  usage: claudeTaskUsageSchema,
  last_tool_name: z.string().optional(),
  summary: z.string().optional(),
});

const claudeTaskUpdatedMessageSchema = claudeTaskMessageSchema.extend({
  subtype: z.literal("task_updated"),
  patch: z.object({
    status: z.enum(["pending", "running", "completed", "failed", "killed", "paused"]).optional(),
    description: z.string().optional(),
    end_time: z.number().optional(),
    total_paused_ms: z.number().optional(),
    error: z.string().optional(),
    is_backgrounded: z.boolean().optional(),
  }),
});

const claudeTaskNotificationMessageSchema = claudeTaskMessageSchema.extend({
  subtype: z.literal("task_notification"),
  tool_use_id: z.string().optional(),
  status: z.enum(["completed", "failed", "stopped"]),
  output_file: z.string(),
  summary: z.string(),
  usage: claudeTaskUsageSchema.optional(),
  skip_transcript: z.boolean().optional(),
});

const claudeHistorySubagentSystemMessageSchema = exactOptionalSchema(
  z.discriminatedUnion("subtype", [
    claudeTaskStartedMessageSchema,
    claudeTaskProgressMessageSchema,
    claudeTaskUpdatedMessageSchema,
    claudeTaskNotificationMessageSchema,
  ]),
) satisfies z.ZodType<ExactOptional<ClaudeHistorySubagentSystemMessage>>;

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
  tool_use_result: claudeUnknownValueSchema.optional(),
  type: z.literal("user"),
  uuid: z.string().optional(),
});

const parseClaudeIngress = <Output>(
  parsed: z.ZodSafeParseResult<Output>,
  field: string,
): Output => {
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
export type ClaudeHistorySubagentSystemMessageIngress = z.output<
  typeof claudeHistorySubagentSystemMessageSchema
>;
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
  parseClaudeIngress(claudeHistoryStoreEntrySchema.safeParse(value), "claudeSessionHistoryEntry");

export const parseClaudeHistorySubagentSystemMessageIngress = (
  value: unknown,
): ClaudeHistorySubagentSystemMessageIngress =>
  parseClaudeIngress(
    claudeHistorySubagentSystemMessageSchema.safeParse(value),
    "claudeHistorySubagentSystemMessage",
  );

export const parseClaudeHistoryConversationEntry = (
  value: unknown,
): z.output<typeof claudeHistoryConversationEntrySchema> =>
  parseClaudeIngress(claudeHistoryConversationEntrySchema.safeParse(value), "claudeHistoryMessage");

export const parseClaudeHistoryAssistantEntry = (
  value: unknown,
): z.output<typeof claudeHistoryAssistantEntrySchema> =>
  parseClaudeIngress(
    claudeHistoryAssistantEntrySchema.safeParse(value),
    "claudeHistoryAssistantMessage",
  );

export const parseClaudeHistoryAttachment = (
  value: unknown,
): z.output<typeof claudeHistoryAttachmentSchema> =>
  parseClaudeIngress(claudeHistoryAttachmentSchema.safeParse(value), "claudeHistoryAttachment");

export const parseClaudeHistoryAttachmentEntry = (
  value: unknown,
): z.output<typeof claudeHistoryAttachmentEntrySchema> =>
  parseClaudeIngress(
    claudeHistoryAttachmentEntrySchema.safeParse(value),
    "claudeHistoryAttachmentEntry",
  );

export const parseClaudeMetaQueuedCommandAttachment = (
  value: unknown,
): z.output<typeof claudeMetaQueuedCommandAttachmentSchema> =>
  parseClaudeIngress(
    claudeMetaQueuedCommandAttachmentSchema.safeParse(value),
    "claudeMetaQueuedCommandAttachment",
  );

export const parseClaudePreToolUseIngress = (value: HookInput) =>
  parseClaudeIngress(claudePreToolUseIngressSchema.safeParse(value), "claudePreToolUse");

export const parseClaudePostToolUseIngress = (value: HookInput): ClaudePostToolUseIngress =>
  parseClaudeIngress(claudePostToolUseIngressSchema.safeParse(value), "claudePostToolUse");

export const parseClaudeFileEditToolResponse = (
  value: unknown,
): z.output<typeof claudePlainUnknownRecordSchema> =>
  parseClaudeIngress(claudePlainUnknownRecordSchema.safeParse(value), "claudeFileEditToolResponse");

export const parseClaudeCanonicalJsonObject = (value: unknown, field: string): JsonObject =>
  parseClaudeIngress(jsonObjectSchema.safeParse(value), field);

export const parseClaudeUserToolResultIngress = (value: unknown): ClaudeUserToolResultIngress => {
  const message = parseClaudeIngress(
    claudeUserToolResultIngressSchema.safeParse(value),
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
  const parsedTopLevelToolUseResult = claudeTopLevelToolUseResultSchema.safeParse(
    message.tool_use_result,
  );
  const topLevelToolUseResult = parsedTopLevelToolUseResult.success
    ? parsedTopLevelToolUseResult.data
    : undefined;
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
