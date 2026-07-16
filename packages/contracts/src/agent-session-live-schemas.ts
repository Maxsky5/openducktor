import { z } from "zod";
import {
  type RuntimeApprovalReplyOutcome,
  type RuntimeApprovalRequestType,
  type RuntimeKind,
  type RuntimeSubagentExecutionMode,
  runtimeApprovalReplyOutcomeSchema,
  runtimeApprovalRequestTypeSchema,
  runtimeKindSchema,
  runtimeSubagentExecutionModeSchema,
} from "./agent-runtime-schemas";
import { agentRoleSchema } from "./agent-workflow-schemas";
import { type FileContent, type FileDiff, fileContentSchema, fileDiffSchema } from "./git-schemas";
import { type SkillDescriptor, skillDescriptorSchema } from "./skill-schemas";
import { type SubagentDescriptor, subagentDescriptorSchema } from "./subagent-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);
const isoTimestampSchema = z.string().datetime({ offset: true });
const finiteNonNegativeNumberSchema = z.number().finite().nonnegative();
const metadataSchema = z.record(z.string(), z.unknown());

type ExactOptional<T> = T extends SkillDescriptor | SubagentDescriptor
  ? T
  : T extends readonly (infer Item)[]
    ? ExactOptional<Item>[]
    : T extends object
      ? {
          [Key in keyof T as undefined extends T[Key] ? never : Key]: ExactOptional<T[Key]>;
        } & {
          [Key in keyof T as undefined extends T[Key] ? Key : never]?: ExactOptional<
            Exclude<T[Key], undefined>
          >;
        }
      : T;

export const agentSessionLiveRefSchema = z
  .object({
    repoPath: nonEmptyStringSchema,
    runtimeKind: runtimeKindSchema,
    workingDirectory: nonEmptyStringSchema,
    externalSessionId: nonEmptyStringSchema,
  })
  .strict();
export type AgentSessionLiveRef = z.infer<typeof agentSessionLiveRefSchema>;

export const agentSessionWorkflowScopeSchema = z
  .object({
    kind: z.literal("workflow"),
    taskId: nonEmptyStringSchema,
    role: agentRoleSchema,
  })
  .strict();
export type AgentSessionWorkflowScope = z.infer<typeof agentSessionWorkflowScopeSchema>;

export const agentSessionContextUsageSchema = z
  .object({
    totalTokens: finiteNonNegativeNumberSchema,
    contextWindow: finiteNonNegativeNumberSchema.optional(),
    outputLimit: finiteNonNegativeNumberSchema.optional(),
    providerId: nonEmptyStringSchema.optional(),
    modelId: nonEmptyStringSchema.optional(),
    variant: nonEmptyStringSchema.optional(),
    profileId: nonEmptyStringSchema.optional(),
  })
  .strict();
export type AgentSessionContextUsage = z.infer<typeof agentSessionContextUsageSchema>;

export const agentSessionActivitySchema = z.enum([
  "waiting_for_question",
  "waiting_for_permission",
  "retrying",
  "running",
  "idle",
]);
export type AgentSessionActivity = z.infer<typeof agentSessionActivitySchema>;

const agentPendingRequestIdSchema = nonEmptyStringSchema;

const agentSessionQuestionOptionSchema = z
  .object({
    label: z.string(),
    description: z.string(),
  })
  .strict();

type AgentTranscriptQuestionItem = {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
  custom?: boolean;
};

const inferredAgentSessionQuestionItemSchema = z
  .object({
    header: z.string(),
    question: z.string(),
    options: z.array(agentSessionQuestionOptionSchema),
    multiple: z.boolean().optional(),
    custom: z.boolean().optional(),
  })
  .strict();
const agentSessionQuestionItemSchema =
  inferredAgentSessionQuestionItemSchema as unknown as z.ZodType<AgentTranscriptQuestionItem>;

export const agentSessionLivePendingApprovalRequestSchema = z
  .object({
    requestId: agentPendingRequestIdSchema,
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
        input: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .optional(),
    mutation: z.enum(["mutating", "read_only", "unknown"]).optional(),
    supportedReplyOutcomes: z.array(runtimeApprovalReplyOutcomeSchema).optional(),
  })
  .strict();
export type AgentSessionLivePendingApprovalRequest = z.infer<
  typeof agentSessionLivePendingApprovalRequestSchema
>;

export const agentSessionLivePendingQuestionRequestSchema = z
  .object({
    requestId: agentPendingRequestIdSchema,
    questions: z.array(agentSessionQuestionItemSchema),
  })
  .strict();
export type AgentSessionLivePendingQuestionRequest = z.infer<
  typeof agentSessionLivePendingQuestionRequestSchema
>;

export const agentSessionLiveSnapshotSchema = z
  .object({
    ref: agentSessionLiveRefSchema,
    activity: agentSessionActivitySchema,
    title: nonEmptyStringSchema,
    startedAt: isoTimestampSchema,
    parentExternalSessionId: nonEmptyStringSchema.optional(),
    pendingApprovals: z.array(agentSessionLivePendingApprovalRequestSchema),
    pendingQuestions: z.array(agentSessionLivePendingQuestionRequestSchema),
    contextUsage: agentSessionContextUsageSchema.nullable(),
  })
  .strict();
export type AgentSessionLiveSnapshot = z.infer<typeof agentSessionLiveSnapshotSchema>;

export const agentSessionLiveReadResultSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("live"),
      session: agentSessionLiveSnapshotSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("missing"),
      ref: agentSessionLiveRefSchema,
    })
    .strict(),
]);
export type AgentSessionLiveReadResult = z.infer<typeof agentSessionLiveReadResultSchema>;

export type AgentTranscriptModelSelection = {
  runtimeKind?: RuntimeKind;
  providerId: string;
  modelId: string;
  variant?: string;
  profileId?: string;
};

const inferredAgentModelSelectionSchema = z
  .object({
    runtimeKind: runtimeKindSchema.optional(),
    providerId: z.string(),
    modelId: z.string(),
    variant: z.string().optional(),
    profileId: z.string().optional(),
  })
  .strict();
export const agentModelSelectionSchema =
  inferredAgentModelSelectionSchema as unknown as z.ZodType<AgentTranscriptModelSelection>;

const agentFileReferenceSchema = z
  .object({
    id: z.string(),
    path: z.string(),
    name: z.string(),
    kind: z.enum(["directory", "css", "code", "image", "video", "default"]),
  })
  .strict();

const agentAttachmentReferenceSchema = z
  .object({
    id: z.string(),
    path: z.string(),
    name: z.string(),
    kind: z.enum(["image", "audio", "video", "pdf"]),
    mime: z.string().optional(),
  })
  .strict();

const agentUserMessageSourceTextSchema = z
  .object({
    value: z.string(),
    start: finiteNonNegativeNumberSchema,
    end: finiteNonNegativeNumberSchema,
  })
  .strict();

type AgentTranscriptFileReference = {
  id: string;
  path: string;
  name: string;
  kind: "directory" | "css" | "code" | "image" | "video" | "default";
};

type AgentTranscriptAttachmentReference = {
  id: string;
  path: string;
  name: string;
  kind: "image" | "audio" | "video" | "pdf";
  mime?: string;
};

type AgentTranscriptUserMessageSourceText = {
  value: string;
  start: number;
  end: number;
};

export type AgentTranscriptUserMessageDisplayPart =
  | { kind: "text"; text: string; synthetic?: boolean }
  | {
      kind: "file_reference";
      file: AgentTranscriptFileReference;
      sourceText?: AgentTranscriptUserMessageSourceText;
    }
  | {
      kind: "skill_mention";
      skill: SkillDescriptor;
      sourceText?: AgentTranscriptUserMessageSourceText;
    }
  | {
      kind: "subagent_reference";
      subagent: SubagentDescriptor;
      sourceText?: AgentTranscriptUserMessageSourceText;
    }
  | { kind: "attachment"; attachment: AgentTranscriptAttachmentReference };

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
      skill: skillDescriptorSchema.strict(),
      sourceText: agentUserMessageSourceTextSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("subagent_reference"),
      subagent: subagentDescriptorSchema.strict(),
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
const agentUserMessageDisplayPartSchema =
  inferredAgentUserMessageDisplayPartSchema as unknown as z.ZodType<AgentTranscriptUserMessageDisplayPart>;

const agentSessionTodoItemSchema = z
  .object({
    id: z.string(),
    content: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    priority: z.enum(["high", "medium", "low"]),
  })
  .strict();
export type AgentTranscriptSessionTodoItem = ExactOptional<
  z.infer<typeof agentSessionTodoItemSchema>
>;

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

export type AgentTranscriptStreamPart =
  | {
      kind: "text";
      messageId: string;
      partId: string;
      text: string;
      synthetic?: boolean;
      completed: boolean;
    }
  | {
      kind: "reasoning";
      messageId: string;
      partId: string;
      text: string;
      completed: boolean;
    }
  | {
      kind: "tool";
      messageId: string;
      partId: string;
      callId: string;
      tool: string;
      toolType: z.infer<typeof agentToolTypeSchema>;
      status: "pending" | "running" | "completed" | "error";
      preview?: string;
      title?: string;
      displayLabel?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
      fileDiffs?: FileDiff[];
      fileContent?: FileContent[];
      fileChanges?: FileDiff[];
      metadata?: Record<string, unknown>;
      startedAtMs?: number;
      endedAtMs?: number;
    }
  | {
      kind: "step";
      messageId: string;
      partId: string;
      phase: "start" | "finish";
      reason?: string;
      cost?: number;
      totalTokens?: number;
      contextWindow?: number;
    }
  | {
      kind: "subagent";
      messageId: string;
      partId: string;
      correlationKey: string;
      status: "pending" | "running" | "completed" | "cancelled" | "error";
      agent?: string;
      prompt?: string;
      description?: string;
      error?: string;
      externalSessionId?: string;
      executionMode?: RuntimeSubagentExecutionMode;
      metadata?: Record<string, unknown>;
      startedAtMs?: number;
      endedAtMs?: number;
    };

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
      input: z.record(z.string(), z.unknown()).optional(),
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
const agentStreamPartSchema: z.ZodType<AgentTranscriptStreamPart> =
  inferredAgentStreamPartSchema as unknown as z.ZodType<AgentTranscriptStreamPart>;

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
  tool?: { name: string; title?: string; input?: Record<string, unknown> };
  mutation?: "mutating" | "read_only" | "unknown";
  supportedReplyOutcomes?: RuntimeApprovalReplyOutcome[];
  metadata?: Record<string, unknown>;
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
        input: z.record(z.string(), z.unknown()).optional(),
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
const eventBaseShape = {
  externalSessionId: z.string(),
  timestamp: isoTimestampSchema,
  sessionRef: agentSessionLiveRefSchema.optional(),
};

const transcriptEventSchema = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object({ ...eventBaseShape, ...shape }).strict();

export const agentRuntimeEventSchema = z.discriminatedUnion("type", [
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
    totalTokens: finiteNonNegativeNumberSchema.optional(),
    contextWindow: finiteNonNegativeNumberSchema.optional(),
    model: agentModelSelectionSchema.optional(),
  }),
  transcriptEventSchema({
    type: z.literal("session_context_updated"),
    totalTokens: finiteNonNegativeNumberSchema,
    contextWindow: finiteNonNegativeNumberSchema.optional(),
  }),
  transcriptEventSchema({
    type: z.literal("user_message"),
    messageId: z.string(),
    message: z.string(),
    parts: z.array(agentUserMessageDisplayPartSchema),
    state: z.enum(["queued", "read"]),
    model: agentModelSelectionSchema.optional(),
  }),
  transcriptEventSchema({
    type: z.literal("assistant_part"),
    part: agentStreamPartSchema,
  }),
  transcriptEventSchema({
    type: z.literal("session_todos_updated"),
    todos: z.array(agentSessionTodoItemSchema),
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
    ...inferredTranscriptPendingApprovalRequestSchema.shape,
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
    ...inferredTranscriptPendingQuestionRequestSchema.shape,
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
export type AgentRuntimeEvent = ExactOptional<z.infer<typeof agentRuntimeEventSchema>>;

type AgentSessionTranscriptEventType =
  | "assistant_delta"
  | "assistant_message"
  | "user_message"
  | "assistant_part"
  | "session_todos_updated"
  | "session_compaction_started"
  | "session_compacted"
  | "mcp_reconnect_started";

const agentSessionTranscriptEventTypes: ReadonlySet<AgentSessionTranscriptEventType> = new Set([
  "assistant_delta",
  "assistant_message",
  "user_message",
  "assistant_part",
  "session_todos_updated",
  "session_compaction_started",
  "session_compacted",
  "mcp_reconnect_started",
]);

export type AgentSessionTranscriptEvent = Extract<
  AgentRuntimeEvent,
  { type: AgentSessionTranscriptEventType }
> & {
  sessionRef: AgentSessionLiveRef;
};

export const agentSessionTranscriptEventSchema: z.ZodType<AgentSessionTranscriptEvent> =
  agentRuntimeEventSchema.refine(
    (event) =>
      agentSessionTranscriptEventTypes.has(event.type as AgentSessionTranscriptEventType) &&
      event.sessionRef !== undefined,
    {
      message:
        "A transcript event must contain a session ref and must not duplicate live projection state.",
    },
  ) as unknown as z.ZodType<AgentSessionTranscriptEvent>;

const attachmentIdSchema = nonEmptyStringSchema;

export const agentSessionLiveScopeSchema = z
  .object({
    repoPath: nonEmptyStringSchema,
    runtimeKind: runtimeKindSchema,
    workingDirectory: nonEmptyStringSchema.optional(),
  })
  .strict();
export type AgentSessionLiveScope = z.infer<typeof agentSessionLiveScopeSchema>;

export const agentSessionLiveEnvelopeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("snapshot"),
      attachmentId: attachmentIdSchema,
      sessions: z.array(agentSessionLiveSnapshotSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal("session_upsert"),
      attachmentId: attachmentIdSchema,
      session: agentSessionLiveSnapshotSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("session_removed"),
      attachmentId: attachmentIdSchema,
      ref: agentSessionLiveRefSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("transcript_event"),
      attachmentId: attachmentIdSchema,
      event: agentSessionTranscriptEventSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("catalog_invalidated"),
      attachmentId: attachmentIdSchema,
      scope: agentSessionLiveScopeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("fault"),
      attachmentId: attachmentIdSchema,
      message: nonEmptyStringSchema,
      operation: nonEmptyStringSchema.optional(),
      ref: agentSessionLiveRefSchema.optional(),
    })
    .strict(),
]);
export type AgentSessionLiveEnvelope = z.infer<typeof agentSessionLiveEnvelopeSchema>;

export const agentSessionLiveListInputSchema = z
  .object({
    repoPath: nonEmptyStringSchema,
  })
  .strict();
export type AgentSessionLiveListInput = z.infer<typeof agentSessionLiveListInputSchema>;

export const agentSessionLiveReadInputSchema = agentSessionLiveRefSchema;
export type AgentSessionLiveReadInput = z.infer<typeof agentSessionLiveReadInputSchema>;

export const agentSessionLiveAttachInputSchema = z
  .object({
    attachmentId: attachmentIdSchema,
    repoPath: nonEmptyStringSchema,
  })
  .strict();
export type AgentSessionLiveAttachInput = z.infer<typeof agentSessionLiveAttachInputSchema>;

export const agentSessionLiveDetachInputSchema = z
  .object({
    attachmentId: attachmentIdSchema,
  })
  .strict();
export type AgentSessionLiveDetachInput = z.infer<typeof agentSessionLiveDetachInputSchema>;

export const agentSessionLiveLoadContextInputSchema = agentSessionLiveRefSchema
  .extend({
    sessionScope: agentSessionWorkflowScopeSchema.optional(),
  })
  .strict();
export type AgentSessionLiveLoadContextInput = z.infer<
  typeof agentSessionLiveLoadContextInputSchema
>;

export const agentSessionLiveLoadContextResultSchema = agentSessionContextUsageSchema.nullable();
export type AgentSessionLiveLoadContextResult = z.infer<
  typeof agentSessionLiveLoadContextResultSchema
>;

export const agentSessionLiveReplyApprovalInputSchema = agentSessionLiveRefSchema.extend({
  requestId: agentPendingRequestIdSchema,
  outcome: runtimeApprovalReplyOutcomeSchema,
  message: z.string().optional(),
});
export type AgentSessionLiveReplyApprovalInput = z.infer<
  typeof agentSessionLiveReplyApprovalInputSchema
>;

export const agentSessionLiveReplyQuestionInputSchema = agentSessionLiveRefSchema.extend({
  requestId: agentPendingRequestIdSchema,
  answers: z.array(z.array(z.string())),
});
export type AgentSessionLiveReplyQuestionInput = z.infer<
  typeof agentSessionLiveReplyQuestionInputSchema
>;
