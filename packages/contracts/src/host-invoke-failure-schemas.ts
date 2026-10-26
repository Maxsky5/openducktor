import { z } from "zod";
import { startupOperationSnapshotSchema } from "./session-startup-schemas";
import { runtimeQueryFailureSchema } from "./runtime-query-failure-schemas";
import {
  acceptedAgentUserMessageSchema,
  acceptedAgentCommandSchema,
} from "./agent-session-control-schemas";
import { runtimeOperationFailureSchema } from "./runtime-operation-failure-schemas";
import { agentSessionLiveRefSchema } from "./agent-session-schemas";
import { browserFailureSchema } from "./browser-tab-schemas";
import { workspaceTextFileWriteFailureSchema } from "./filesystem-schemas";
import { sessionHistoryFailureSchema } from "./session-history-failure-schemas";
import { taskAssetFailureSchema } from "./task-asset-schemas";
import { terminalFailureSchema } from "./terminal-schemas";
import { sessionOperationObservationSchema } from "./workflow-operation-schemas";

export const agentSessionResumeFailureReasonSchema = z.enum([
  "unsupported",
  "continuation_in_progress",
  "live_turn",
  "waiting_input",
  "completed_turn",
  "ineligible_turn_state",
  "runtime_unavailable",
  "session_not_found",
  "identity_mismatch",
  "probe_failed",
  "continuation_failed",
]);
export type AgentSessionResumeFailureReason = z.infer<typeof agentSessionResumeFailureReasonSchema>;

export const agentSessionResumeFailureSchema = z
  .object({
    reason: agentSessionResumeFailureReasonSchema,
    sessionRef: agentSessionLiveRefSchema,
    operation: z.string().trim().min(1),
    message: z.string().trim().min(1),
    nextAction: z.string().trim().min(1),
    nativeOutcome: z.enum(["not_issued", "refused", "accepted", "uncertain"]).optional(),
    cause: z.string().trim().min(1).optional(),
  })
  .strict();

export type AgentSessionResumeFailure = z.infer<typeof agentSessionResumeFailureSchema>;

export const hostInvokeFailureSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("session_startup"),
    startupProgress: startupOperationSnapshotSchema,
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("session_operation"),
    observation: sessionOperationObservationSchema,
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("workflow_intent_rejected"),
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("runtime_operation"),
    runtimeOperationFailure: runtimeOperationFailureSchema,
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("agent_session_command_accepted"),
    sessionRef: agentSessionLiveRefSchema,
    acceptedCommand: acceptedAgentCommandSchema,
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("workspace_session_validation"),
    field: z.enum(["worktree.name", "worktree.branchName"]),
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("agent_session_message_accepted"),
    sessionRef: agentSessionLiveRefSchema,
    acceptedMessage: acceptedAgentUserMessageSchema,
    stage: z.enum(["live_update", "record_message"]),
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("workspace_session_confirmation"),
    field: z.literal("confirmStop"),
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("runtime_query"),
    runtimeQueryFailure: runtimeQueryFailureSchema,
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("terminal"),
    terminalFailure: terminalFailureSchema,
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("browser"),
    browserFailure: browserFailureSchema,
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("task_asset"),
    taskAssetFailure: taskAssetFailureSchema,
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("session_history"),
    sessionHistoryFailure: sessionHistoryFailureSchema,
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("agent_session_resume"),
    agentSessionResumeFailure: agentSessionResumeFailureSchema,
  }),
  z.strictObject({
    startupProgress: startupOperationSnapshotSchema.optional(),
    kind: z.literal("workspace_text_file_write"),
    workspaceTextFileWriteFailure: workspaceTextFileWriteFailureSchema,
  }),
]);
export type HostInvokeFailure = z.infer<typeof hostInvokeFailureSchema>;

export const hostErrorResponseSchema = z
  .object({
    error: z.string().trim().min(1).optional(),
    failure: hostInvokeFailureSchema.optional(),
    failureKind: z.string().trim().min(1).optional(),
    message: z.string().trim().min(1).optional(),
  })
  .catchall(z.json());
export type HostErrorResponse = z.infer<typeof hostErrorResponseSchema>;
