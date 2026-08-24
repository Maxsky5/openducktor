import { z } from "zod";
import {
  type RuntimeApprovalReplyOutcome,
  type RuntimeApprovalRequestType,
  runtimeApprovalReplyOutcomeSchema,
  runtimeApprovalRequestTypeSchema,
  runtimeSubagentExecutionModeSchema,
} from "./agent-runtime-schemas";
import {
  type AgentTranscriptQuestionItem,
  agentSessionQuestionItemSchema,
} from "./agent-session-pending-schemas";
import {
  type AgentSessionLiveRef,
  agentModelSelectionSchema,
  agentSessionLiveRefSchema,
} from "./agent-session-schemas";
import { fileContentSchema, fileDiffSchema } from "./git-schemas";
import { exactOptionalSchema, type ExactOptional } from "./exact-optional";

type ZodSchemaFields = Parameters<typeof z.object>[0];
import { jsonValueSchema } from "./json-types";
import type { JsonValue } from "./json-types";
import { skillDescriptorSchema } from "./skill-schemas";
import { slashCommandCatalogSchema } from "./slash-command-schemas";
import { subagentDescriptorSchema } from "./subagent-schemas";

const isoTimestampSchema = z.string().datetime({ offset: true });
const finiteNonNegativeNumberSchema = z.number().finite().nonnegative();
const metadataSchema = z.record(z.string(), jsonValueSchema);

export const agentFileReferenceSchema = z
  .object({
    id: z.string(),
    path: z.string(),
    name: z.string(),
    kind: z.enum(["directory", "css", "code", "image", "video", "default"]),
  })
  .strict();

export const agentAttachmentReferenceSchema = z
  .object({
    id: z.string(),
    path: z.string(),
    name: z.string(),
    kind: z.enum(["image", "audio", "video", "pdf"]),
    mime: z.string().optional(),
    localPreviewAvailable: z.boolean().optional(),
  })
  .strict();

const agentUserMessageSourceTextSchema = z
  .object({
    value: z.string(),
    start: finiteNonNegativeNumberSchema,
    end: finiteNonNegativeNumberSchema,
  })
  .strict();

const inferredAgentUserMessageDisplayPartSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      text: z.string(),
      synthetic: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("file_reference"),
      file: agentFileReferenceSchema,
      sourceText: agentUserMessageSourceTextSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("skill_mention"),
      skill: skillDescriptorSchema,
      sourceText: agentUserMessageSourceTextSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("subagent_reference"),
      subagent: subagentDescriptorSchema,
      sourceText: agentUserMessageSourceTextSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("attachment"),
      attachment: agentAttachmentReferenceSchema,
    })
    .strict(),
]);
export const agentUserMessageDisplayPartSchema = exactOptionalSchema(
  inferredAgentUserMessageDisplayPartSchema,
);
export type AgentTranscriptUserMessageDisplayPart = z.infer<
  typeof agentUserMessageDisplayPartSchema
>;

export const agentSessionTodoStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
export const agentSessionTodoPrioritySchema = z.enum(["high", "medium", "low"]);

export const agentSessionTodoItemSchema = z
  .object({
    id: z.string(),
    content: z.string(),
    status: agentSessionTodoStatusSchema,
    priority: agentSessionTodoPrioritySchema,
  })
  .strict();
export type AgentTranscriptSessionTodoItem = z.infer<typeof agentSessionTodoItemSchema>;

const agentToolTypeSchema = z.enum([
  "bash",
  "read",
  "list",
  "search",
  "web",
  "todo",
  "file_edit",
  "workflow",
  "question",
  "generic",
]);

const inferredAgentStreamPartSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      messageId: z.string(),
      partId: z.string(),
      text: z.string(),
      synthetic: z.boolean().optional(),
      completed: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reasoning"),
      messageId: z.string(),
      partId: z.string(),
      text: z.string(),
      completed: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tool"),
      messageId: z.string(),
      partId: z.string(),
      callId: z.string(),
      tool: z.string(),
      toolType: agentToolTypeSchema,
      status: z.enum(["pending", "running", "completed", "error"]),
      preview: z.string().optional(),
      title: z.string().optional(),
      displayLabel: z.string().optional(),
      input: z.record(z.string(), jsonValueSchema).optional(),
      output: z.string().optional(),
      error: z.string().optional(),
      fileDiffs: z.array(fileDiffSchema.strict()).optional(),
      fileContent: z.array(fileContentSchema.strict()).optional(),
      fileChanges: z.array(fileDiffSchema.strict()).optional(),
      metadata: metadataSchema.optional(),
      startedAtMs: finiteNonNegativeNumberSchema.optional(),
      endedAtMs: finiteNonNegativeNumberSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("step"),
      messageId: z.string(),
      partId: z.string(),
      phase: z.enum(["start", "finish"]),
      reason: z.string().optional(),
      cost: finiteNonNegativeNumberSchema.optional(),
      totalTokens: finiteNonNegativeNumberSchema.optional(),
      contextWindow: finiteNonNegativeNumberSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("subagent"),
      messageId: z.string(),
      partId: z.string(),
      correlationKey: z.string(),
      status: z.enum(["pending", "running", "completed", "cancelled", "error"]),
      agent: z.string().optional(),
      prompt: z.string().optional(),
      description: z.string().optional(),
      error: z.string().optional(),
      externalSessionId: z.string().optional(),
      executionMode: runtimeSubagentExecutionModeSchema.optional(),
      metadata: metadataSchema.optional(),
      startedAtMs: finiteNonNegativeNumberSchema.optional(),
      endedAtMs: finiteNonNegativeNumberSchema.optional(),
    })
    .strict(),
]);
export const agentStreamPartSchema = exactOptionalSchema(inferredAgentStreamPartSchema);
export type AgentTranscriptStreamPart = z.infer<typeof agentStreamPartSchema>;

const agentSessionStatusSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("busy"),
      message: z.string().nullable(),
    })
    .strict(),
  z.object({ type: z.literal("idle") }).strict(),
  z
    .object({
      type: z.literal("retry"),
      attempt: finiteNonNegativeNumberSchema,
      message: z.string(),
      nextEpochMs: finiteNonNegativeNumberSchema,
    })
    .strict(),
]);
export type AgentTranscriptSessionStatus = ExactOptional<z.infer<typeof agentSessionStatusSchema>>;

export type AgentTranscriptPendingApprovalRequest = {
  requestId: string;
  requestInstanceId?: string;
  requestType: RuntimeApprovalRequestType;
  title: string;
  summary?: string;
  details?: string;
  affectedPaths?: string[];
  command?: { command: string; workingDirectory?: string };
  action?: { name: string; description?: string };
  tool?: { name: string; title?: string; input?: Record<string, JsonValue> };
  mutation?: "mutating" | "read_only" | "unknown";
  supportedReplyOutcomes?: RuntimeApprovalReplyOutcome[];
  metadata?: Record<string, JsonValue>;
};

const inferredTranscriptPendingApprovalRequestSchema = z
  .object({
    requestId: z.string(),
    requestInstanceId: z.string().optional(),
    requestType: runtimeApprovalRequestTypeSchema,
    title: z.string(),
    summary: z.string().optional(),
    details: z.string().optional(),
    affectedPaths: z.array(z.string()).optional(),
    command: z
      .object({
        command: z.string(),
        workingDirectory: z.string().optional(),
      })
      .strict()
      .optional(),
    action: z
      .object({
        name: z.string(),
        description: z.string().optional(),
      })
      .strict()
      .optional(),
    tool: z
      .object({
        name: z.string(),
        title: z.string().optional(),
        input: z.record(z.string(), jsonValueSchema).optional(),
      })
      .strict()
      .optional(),
    mutation: z.enum(["mutating", "read_only", "unknown"]).optional(),
    supportedReplyOutcomes: z.array(runtimeApprovalReplyOutcomeSchema).optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();
export type AgentTranscriptPendingQuestionRequest = {
  requestId: string;
  requestInstanceId?: string;
  questions: AgentTranscriptQuestionItem[];
};

const inferredTranscriptPendingQuestionRequestSchema = z
  .object({
    requestId: z.string(),
    requestInstanceId: z.string().optional(),
    questions: z.array(agentSessionQuestionItemSchema),
  })
  .strict();
const eventBaseFields = {
  externalSessionId: z.string(),
  timestamp: isoTimestampSchema,
  sessionRef: agentSessionLiveRefSchema.optional(),
};

const transcriptEventSchema = <Fields extends ZodSchemaFields>(fields: Fields) =>
  z.object({ ...eventBaseFields, ...fields }).strict();

export const agentUserMessageEventSchema = transcriptEventSchema({
  type: z.literal("user_message"),
  messageId: z.string(),
  message: z.string(),
  parts: z.array(agentUserMessageDisplayPartSchema),
  state: z.enum(["queued", "read"]),
  model: agentModelSelectionSchema.optional(),
});

const inferredAgentRuntimeEventSchema = z.discriminatedUnion("type", [
  transcriptEventSchema({
    type: z.literal("session_started"),
    message: z.string(),
  }),
  transcriptEventSchema({
    type: z.literal("assistant_delta"),
    channel: z.enum(["text", "reasoning"]),
    messageId: z.string().optional(),
    delta: z.string(),
  }),
  transcriptEventSchema({
    type: z.literal("assistant_message"),
    messageId: z.string(),
    message: z.string(),
    durationMs: finiteNonNegativeNumberSchema.optional(),
    totalTokens: finiteNonNegativeNumberSchema.optional(),
    contextWindow: finiteNonNegativeNumberSchema.optional(),
    model: agentModelSelectionSchema.optional(),
  }),
  transcriptEventSchema({
    type: z.literal("transcript_retracted"),
    messageIds: z.array(z.string()),
  }),
  transcriptEventSchema({
    type: z.literal("session_context_updated"),
    totalTokens: finiteNonNegativeNumberSchema,
    contextWindow: finiteNonNegativeNumberSchema.optional(),
  }),
  transcriptEventSchema({
    type: z.literal("session_context_error"),
    message: z.string(),
  }),
  agentUserMessageEventSchema,
  transcriptEventSchema({
    type: z.literal("assistant_part"),
    part: agentStreamPartSchema,
  }),
  transcriptEventSchema({
    type: z.literal("session_todos_updated"),
    todos: z.array(agentSessionTodoItemSchema),
  }),
  transcriptEventSchema({
    type: z.literal("runtime_slash_commands_changed"),
    catalog: slashCommandCatalogSchema,
  }),
  transcriptEventSchema({
    type: z.literal("session_compaction_started"),
    messageId: z.string().optional(),
    message: z.string(),
  }),
  transcriptEventSchema({
    type: z.literal("session_compacted"),
    messageId: z.string().optional(),
    message: z.string(),
  }),
  transcriptEventSchema({
    type: z.literal("approval_required"),
    ...inferredTranscriptPendingApprovalRequestSchema["shape"],
    parentExternalSessionId: z.string().optional(),
    childExternalSessionId: z.string().optional(),
    subagentCorrelationKey: z.string().optional(),
  }),
  transcriptEventSchema({
    type: z.literal("approval_resolved"),
    requestId: z.string(),
    requestInstanceId: z.string().optional(),
    parentExternalSessionId: z.string().optional(),
    childExternalSessionId: z.string().optional(),
    subagentCorrelationKey: z.string().optional(),
  }),
  transcriptEventSchema({
    type: z.literal("question_required"),
    ...inferredTranscriptPendingQuestionRequestSchema["shape"],
    parentExternalSessionId: z.string().optional(),
    childExternalSessionId: z.string().optional(),
    subagentCorrelationKey: z.string().optional(),
  }),
  transcriptEventSchema({
    type: z.literal("question_resolved"),
    requestId: z.string(),
    requestInstanceId: z.string().optional(),
    parentExternalSessionId: z.string().optional(),
    childExternalSessionId: z.string().optional(),
    subagentCorrelationKey: z.string().optional(),
  }),
  transcriptEventSchema({
    type: z.literal("session_status"),
    status: agentSessionStatusSchema,
  }),
  transcriptEventSchema({
    type: z.literal("mcp_reconnect_started"),
    serverName: z.string(),
    workingDirectory: z.string(),
    status: z.string(),
    errorDetails: z.string().optional(),
  }),
  transcriptEventSchema({
    type: z.literal("turn_error"),
    messageId: z.string().optional(),
    message: z.string(),
  }),
  transcriptEventSchema({
    type: z.literal("session_error"),
    message: z.string(),
  }),
  transcriptEventSchema({
    type: z.literal("session_idle"),
  }),
  transcriptEventSchema({
    type: z.literal("session_finished"),
    message: z.string(),
  }),
]);
export const agentRuntimeEventSchema = exactOptionalSchema(inferredAgentRuntimeEventSchema);
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>;

export type AgentSessionTranscriptEventType =
  | "session_started"
  | "assistant_delta"
  | "assistant_message"
  | "transcript_retracted"
  | "user_message"
  | "assistant_part"
  | "session_todos_updated"
  | "session_compaction_started"
  | "session_compacted"
  | "mcp_reconnect_started"
  | "session_status"
  | "turn_error"
  | "session_error"
  | "session_idle"
  | "session_finished";

const agentSessionTranscriptEventTypes: ReadonlySet<string> = new Set([
  "session_started",
  "assistant_delta",
  "assistant_message",
  "transcript_retracted",
  "user_message",
  "assistant_part",
  "session_todos_updated",
  "session_compaction_started",
  "session_compacted",
  "mcp_reconnect_started",
  "session_status",
  "turn_error",
  "session_error",
  "session_idle",
  "session_finished",
]);

export const isAgentSessionTranscriptEventType = (
  type: AgentRuntimeEvent["type"] | string,
): type is AgentSessionTranscriptEventType => agentSessionTranscriptEventTypes.has(type);

export type AgentSessionTranscriptEvent = Extract<
  AgentRuntimeEvent,
  { type: AgentSessionTranscriptEventType }
> & {
  sessionRef: AgentSessionLiveRef;
};

export const agentSessionTranscriptEventSchema = agentRuntimeEventSchema.refine(
  (event): event is AgentSessionTranscriptEvent =>
    isAgentSessionTranscriptEventType(event.type) && event.sessionRef !== undefined,
  {
    message:
      "A transcript event must contain a session ref and belong to the ordered session stream.",
  },
) satisfies z.ZodType<AgentSessionTranscriptEvent>;
