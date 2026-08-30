import type {
  CanUseTool,
  HookInput,
  SDKMessage,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { type JsonObject, jsonObjectSchema } from "@openducktor/contracts";
import type { AgentStreamPart } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import { z } from "zod";

const claudeToolHookSchema = z.object({
  agent_id: z.string().min(1).optional(),
  tool_input: jsonObjectSchema,
  tool_name: z.string().min(1),
  tool_use_id: z.string().min(1),
});

const claudeContentSourceSchema = z.object({
  media_type: z.string().optional(),
});

const claudeContentBlockSchema = z.object({
  arguments: jsonObjectSchema.optional(),
  custom_tool_use_id: z.string().optional(),
  id: z.string().optional(),
  input: jsonObjectSchema.optional(),
  name: z.string().optional(),
  server_name: z.string().optional(),
  source: claudeContentSourceSchema.optional(),
  text: z.string().optional(),
  thinking: z.string().optional(),
  title: z.string().optional(),
  tool: z.string().optional(),
  tool_input: jsonObjectSchema.optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  type: z.string().min(1),
});

export type ClaudeContentBlockIngress = z.output<typeof claudeContentBlockSchema>;

const claudeUserMessagePayloadSchema = z.object({
  content: z.union([z.string(), z.array(claudeContentBlockSchema)]),
});

const claudeToolResultBlockSchema = z.union([
  jsonObjectSchema.and(
    z.object({
      tool_use_id: z.string().min(1),
      type: z.literal("tool_result"),
    }),
  ),
  jsonObjectSchema.and(
    z.object({
      tool_use_id: z.string().min(1),
      type: z.literal("mcp_tool_result"),
    }),
  ),
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

const claudeUserToolResultMessagePayloadSchema = z.object({
  content: z.union([z.string(), z.array(claudeUserToolResultContentBlockSchema)]),
});

const claudeUserTurnOriginSchema = z.object({
  kind: z.string().min(1),
});

const claudeStructuredToolUseResultSchema = jsonObjectSchema.and(
  z.object({
    type: z
      .string()
      .min(1)
      .refine((type) => type !== "tool_result" && type !== "mcp_tool_result")
      .optional(),
  }),
);

const claudeTopLevelToolUseResultSchema = z.union([
  claudeToolResultBlockSchema.transform((result) => ({ kind: "tool_result" as const, result })),
  claudeStructuredToolUseResultSchema.transform((structuredOutput) => ({
    kind: "structured_output" as const,
    structuredOutput,
  })),
]);

const claudeAssistantMessagePayloadSchema = z.object({
  content: z.array(claudeContentBlockSchema),
  id: z.string().optional(),
  model: z.string().optional(),
  stop_reason: z.string().nullable().optional(),
});

const claudeHistoryConversationEntrySchema = z.object({
  message: claudeUserMessagePayloadSchema,
});

const claudeHistoryAssistantEntrySchema = z.object({
  message: claudeAssistantMessagePayloadSchema,
});

const claudeHistoryAttachmentSchema = z.object({
  isMeta: z.boolean().optional(),
  prompt: z.string().optional(),
  timestamp: z.string().optional(),
  type: z.string().min(1),
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

const claudeTaskMessageSchema = z.object({
  type: z.literal("system"),
  task_id: z.string(),
  uuid: z.string(),
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

const claudeHistorySubagentSystemMessageSchema = z.discriminatedUnion("subtype", [
  claudeTaskStartedMessageSchema,
  claudeTaskProgressMessageSchema,
  claudeTaskUpdatedMessageSchema,
  claudeTaskNotificationMessageSchema,
]);

export const claudeHistoryStoreEntrySchema = z.object({
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

export const claudeUserToolResultIngressSchema = z.object({
  message: claudeUserToolResultMessagePayloadSchema,
  origin: claudeUserTurnOriginSchema.optional(),
  parent_tool_use_id: z.string().min(1).nullable().optional(),
  shouldQuery: z.boolean().optional(),
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

type ClaudePostToolUseSuccessIngress = z.output<typeof claudePostToolUseSuccessIngressSchema> &
  Pick<Extract<HookInput, { hook_event_name: "PostToolUse" }>, "tool_response">;
export type ClaudePostToolUseIngress =
  | ClaudePostToolUseSuccessIngress
  | z.output<typeof claudePostToolUseFailureIngressSchema>;
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
  value: SessionStoreEntry,
): ClaudeHistorySubagentSystemMessageIngress =>
  parseClaudeIngress(
    claudeHistorySubagentSystemMessageSchema.safeParse(value),
    "claudeHistorySubagentSystemMessage",
  );

export const parseClaudeHistoryConversationEntry = (
  value: SessionStoreEntry,
): z.output<typeof claudeHistoryConversationEntrySchema> =>
  parseClaudeIngress(claudeHistoryConversationEntrySchema.safeParse(value), "claudeHistoryMessage");

export const parseClaudeHistoryAssistantEntry = (
  value: SessionStoreEntry,
): z.output<typeof claudeHistoryAssistantEntrySchema> =>
  parseClaudeIngress(
    claudeHistoryAssistantEntrySchema.safeParse(value),
    "claudeHistoryAssistantMessage",
  );

export const parseClaudeHistoryAttachment = (
  value: SessionStoreEntry[string],
): z.output<typeof claudeHistoryAttachmentSchema> =>
  parseClaudeIngress(claudeHistoryAttachmentSchema.safeParse(value), "claudeHistoryAttachment");

export const parseClaudeMetaQueuedCommandAttachment = (
  value: SessionStoreEntry[string],
): z.output<typeof claudeMetaQueuedCommandAttachmentSchema> =>
  parseClaudeIngress(
    claudeMetaQueuedCommandAttachmentSchema.safeParse(value),
    "claudeMetaQueuedCommandAttachment",
  );

export const parseClaudePreToolUseIngress = (value: HookInput) =>
  parseClaudeIngress(claudePreToolUseIngressSchema.safeParse(value), "claudePreToolUse");

export const parseClaudePostToolUseIngress = (value: HookInput): ClaudePostToolUseIngress => {
  if (value.hook_event_name === "PostToolUse") {
    const parsed = parseClaudeIngress(
      claudePostToolUseSuccessIngressSchema.safeParse(value),
      "claudePostToolUse",
    );
    return { ...parsed, tool_response: value.tool_response };
  }
  return parseClaudeIngress(
    claudePostToolUseFailureIngressSchema.safeParse(value),
    "claudePostToolUse",
  );
};

export const parseClaudeFileEditToolResponse = (
  value: Extract<HookInput, { hook_event_name: "PostToolUse" }>["tool_response"],
): JsonObject =>
  parseClaudeIngress(jsonObjectSchema.safeParse(value), "claudeFileEditToolResponse");

type ClaudeToolMetadata = NonNullable<Extract<AgentStreamPart, { kind: "tool" }>["metadata"]>;
type ClaudeCanonicalJsonObjectInput = Parameters<CanUseTool>[1] | ClaudeToolMetadata | JsonObject;

export const parseClaudeCanonicalJsonObject = (
  value: ClaudeCanonicalJsonObjectInput,
  field: string,
): JsonObject => parseClaudeIngress(jsonObjectSchema.safeParse(value), field);

export const parseClaudeUserToolResultIngress = (
  value: Extract<SDKMessage, { type: "user" }> | SessionStoreEntry,
): ClaudeUserToolResultIngress => {
  const message = parseClaudeIngress(
    claudeUserToolResultIngressSchema.safeParse(value),
    "claudeUserToolResult",
  );
  const contentToolResults = Array.isArray(message.message.content)
    ? message.message.content.flatMap((block) => (block.kind === "tool_result" ? [block.raw] : []))
    : [];
  const normalizedMessage: Omit<ClaudeUserToolResultIngress, "toolResults"> = {
    message: message.message,
    type: message.type,
  };
  if (message.parent_tool_use_id !== undefined) {
    normalizedMessage.parent_tool_use_id = message.parent_tool_use_id;
  }
  if (message.shouldQuery !== false && message.origin !== undefined) {
    normalizedMessage.turnOriginKind = message.origin.kind;
  }
  if (message.uuid !== undefined) {
    normalizedMessage.uuid = message.uuid;
  }
  const parsedTopLevelToolUseResult = claudeTopLevelToolUseResultSchema.safeParse(
    value.tool_use_result,
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
