import { z } from "zod";
import { workspaceIdSchema } from "./workspace-id-schemas";
import {
  acceptedAgentInputSchema,
  acceptedAgentCommandSchema,
} from "./agent-session-control-schemas";
import { agentModelSelectionSchema, agentSessionLiveRefSchema } from "./agent-session-schemas";
import { workflowFailureSchema } from "./workflow-failure-schemas";
import { handoffLinkSchema, handoffTargetSchema } from "./agent-chat-handoff-schemas";

export { workflowFailureSchema, type WorkflowFailure } from "./workflow-failure-schemas";

const text = z.string().min(1);
const liveHandoffSchema = handoffTargetSchema.omit({ submissionId: true }).extend({
  acceptedLink: handoffLinkSchema.optional(),
  destinationStartedAt: z.iso.datetime().optional(),
  committed: z.literal(true).optional(),
  unsupportedPartIndexes: z.array(z.number().int().nonnegative()).optional(),
});
const restoredHandoffSchema = liveHandoffSchema.extend({
  destination: z.never().optional(),
  acceptedLink: handoffLinkSchema,
  committed: z.literal(true),
});

export const sessionOperationObservationSchema = z.strictObject({
  ref: agentSessionLiveRefSchema,
  kind: z.enum(["submission", "reattach", "continue", "stop", "model", "handoff"]),
  submissionId: text.optional(),
  pending: z.boolean(),
  nativeOutcome: z.enum(["not_issued", "refused", "accepted", "uncertain"]),
  reattached: z.literal(true).optional(),
  modelChange: z
    .strictObject({
      selection: agentModelSelectionSchema.nullable(),
      state: z.enum(["committed", "restored", "unresolved"]),
    })
    .optional(),
  acceptedInput: acceptedAgentInputSchema.optional(),
  handoff: z.union([liveHandoffSchema, restoredHandoffSchema]).optional(),
  failure: workflowFailureSchema.optional(),
});
export type SessionOperationObservation = z.infer<typeof sessionOperationObservationSchema>;
export const submissionAcknowledgementSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ref: agentSessionLiveRefSchema,
    submissionId: text,
    kind: z.literal("message"),
    messageId: text,
  }),
  z.strictObject({
    ref: agentSessionLiveRefSchema,
    submissionId: text,
    kind: z.literal("command"),
    acceptedCommand: acceptedAgentCommandSchema,
  }),
]);
export type SubmissionAcknowledgement = z.infer<typeof submissionAcknowledgementSchema>;
export const taskCompletionObservationSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  repoPath: text,
  taskId: text,
  phase: z.enum(["publishing", "cleanup", "settled"]),
  confirmedDestinations: z.array(text),
  uncertainDestinations: z.array(text),
  cleanupCompleted: z.literal(true).optional(),
  taskClosed: z.literal(true).optional(),
  failure: workflowFailureSchema.optional(),
});
export type TaskCompletionObservation = z.infer<typeof taskCompletionObservationSchema>;

/**
 * The host-planned resume of the latest usage-limit stop of one session. The host keeps it in
 * memory. `stopId` names the stop and is opaque to clients.
 */
const usageLimitAutoResumeFields = {
  ref: agentSessionLiveRefSchema,
  stopId: text,
  resumeAtEpochMs: z.number().int().nonnegative(),
};
export const usageLimitAutoResumeSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...usageLimitAutoResumeFields, state: z.enum(["scheduled", "resuming"]) }),
  z.strictObject({
    ...usageLimitAutoResumeFields,
    state: z.literal("failed"),
    failure: workflowFailureSchema,
  }),
]);
export type UsageLimitAutoResume = z.infer<typeof usageLimitAutoResumeSchema>;
