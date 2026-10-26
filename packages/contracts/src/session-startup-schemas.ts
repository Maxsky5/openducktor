import { z } from "zod";
import { agentRoleSchema } from "./agent-workflow-schemas";
import { agentSessionLiveRefSchema } from "./agent-session-schemas";
import { agentSessionRecordSchema } from "./session-schemas";
import { agentSessionControlSummarySchema } from "./agent-session-summary-schemas";
import { workspaceSessionSchema } from "./workspace-session-schemas";
import { terminalCommandResultSchema, terminalIdSchema } from "./terminal-schemas";
import { workflowFailureSchema } from "./workflow-failure-schemas";
import { startupOperationContextSchema } from "./session-startup-context-schemas";

export {
  startupOperationContextSchema,
  type StartupOperationContext,
} from "./session-startup-context-schemas";

export const startupScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("task"), taskId: z.string().min(1), role: agentRoleSchema }),
  z.strictObject({ kind: z.literal("workspace"), sessionId: z.string().min(1).optional() }),
]);
export type StartupScope = z.infer<typeof startupScopeSchema>;

export const savedStartupTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("task"),
    record: agentSessionRecordSchema,
    runtimeSession: agentSessionControlSummarySchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("workspace"),
    record: workspaceSessionSchema,
    runtimeSession: agentSessionControlSummarySchema.optional(),
  }),
]);
export type SavedStartupTarget = z.infer<typeof savedStartupTargetSchema>;

export const startupOwnershipSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("not_saved") }),
  z.strictObject({ state: z.literal("saved"), target: savedStartupTargetSchema }),
  z.strictObject({ state: z.literal("unknown") }),
]);
export type StartupOwnership = z.infer<typeof startupOwnershipSchema>;

export const startupPreparedHandoffSchema = z.strictObject({
  ref: agentSessionLiveRefSchema,
  runtimeId: z.string().min(1),
  liveStateSequence: z.number().int().nonnegative(),
});
export type StartupPreparedHandoff = z.infer<typeof startupPreparedHandoffSchema>;

export const startupInstructionSchema = z.strictObject({
  submissionId: z.string().min(1).optional(),
  state: z.enum(["submitting", "accepted", "queued", "not_sent", "unknown"]),
  messageId: z.string().min(1).optional(),
  failure: workflowFailureSchema.optional(),
});
export type StartupInstruction = z.infer<typeof startupInstructionSchema>;

export const startupStepSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  state: z.enum(["pending", "waiting", "running", "completed", "failed", "not_run"]),
  details: z.array(z.string()),
  action: z
    .strictObject({
      actionId: z.string().min(1),
      command: z.string(),
      waitBeforeAgentStart: z.boolean(),
      terminalId: terminalIdSchema.optional(),
      result: terminalCommandResultSchema.optional(),
    })
    .optional(),
  resources: z
    .array(
      z.strictObject({
        kind: z.enum(["worktree", "branch", "terminal"]),
        value: z.string().min(1),
        state: z.enum(["created", "reused", "removed", "retained", "unknown"]),
        nextAction: z.string().optional(),
      }),
    )
    .optional(),
  failure: workflowFailureSchema.optional(),
});
export type StartupStep = z.infer<typeof startupStepSchema>;

export const startupOperationSnapshotSchema = z.strictObject({
  context: startupOperationContextSchema,
  hostInstanceId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workspaceId: z.string().min(1),
  repoPath: z.string().min(1),
  scope: startupScopeSchema,
  phase: z.enum(["waiting", "running", "settling", "completed", "failed", "canceled"]),
  steps: z.array(startupStepSchema),
  ownership: startupOwnershipSchema,
  prepared: startupPreparedHandoffSchema.optional(),
  instruction: startupInstructionSchema.optional(),
});
export type StartupOperationSnapshot = z.infer<typeof startupOperationSnapshotSchema>;

export const sessionStartupProgressEventSchema = z.strictObject({
  channel: z.literal("openducktor://session-startup-progress"),
  payload: startupOperationSnapshotSchema,
});
export type SessionStartupProgressEvent = z.infer<typeof sessionStartupProgressEventSchema>;
