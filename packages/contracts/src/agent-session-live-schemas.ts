import { z } from "zod";
import {
  runtimeApprovalReplyOutcomeSchema,
  runtimeApprovalRequestTypeSchema,
  runtimeKindSchema,
} from "./agent-runtime-schemas";
import { agentSessionTranscriptEventSchema } from "./agent-session-event-schemas";
import { agentSessionQuestionItemSchema } from "./agent-session-pending-schemas";
import {
  agentSessionLiveRefSchema,
  agentSessionWorkflowScopeSchema,
} from "./agent-session-schemas";
import { slashCommandCatalogSchema } from "./slash-command-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);
const isoTimestampSchema = z.string().datetime({ offset: true });
const finiteNonNegativeNumberSchema = z.number().finite().nonnegative();

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
      repoPath: nonEmptyStringSchema,
      sessions: z.array(agentSessionLiveSnapshotSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal("session_upsert"),
      session: agentSessionLiveSnapshotSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("session_removed"),
      ref: agentSessionLiveRefSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("transcript_event"),
      event: agentSessionTranscriptEventSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("catalog_invalidated"),
      scope: agentSessionLiveScopeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("slash_command_catalog_updated"),
      scope: agentSessionLiveScopeSchema.extend({
        workingDirectory: nonEmptyStringSchema,
      }),
      catalog: slashCommandCatalogSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("transcript_gap"),
      repoPath: nonEmptyStringSchema,
      message: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("fault"),
      repoPath: nonEmptyStringSchema,
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

export const agentSessionLiveRefreshInputSchema = agentSessionLiveListInputSchema;
export type AgentSessionLiveRefreshInput = AgentSessionLiveListInput;

export const agentSessionLiveReadInputSchema = agentSessionLiveRefSchema;
export type AgentSessionLiveReadInput = z.infer<typeof agentSessionLiveReadInputSchema>;

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
