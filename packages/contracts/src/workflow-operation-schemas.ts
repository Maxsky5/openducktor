import { z } from "zod";
import {
  acceptedAgentInputSchema,
  acceptedAgentCommandSchema,
} from "./agent-session-control-schemas";
import { agentModelSelectionSchema, agentSessionLiveRefSchema } from "./agent-session-schemas";
import { workflowFailureSchema } from "./workflow-failure-schemas";

export { workflowFailureSchema, type WorkflowFailure } from "./workflow-failure-schemas";

const text = z.string().min(1);
export const sessionOperationObservationSchema = z.strictObject({
  ref: agentSessionLiveRefSchema,
  kind: z.enum(["submission", "reattach", "continue", "stop", "model"]),
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
