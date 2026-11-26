import { z } from "zod";
import { agentChatRefSchema, handoffTargetSchema } from "./agent-chat-handoff-schemas";
import { agentSessionMessageContentFields } from "./agent-session-control-schemas";
import { sessionOperationObservationSchema } from "./workflow-operation-schemas";

export const agentChatHandoffSendSchema = handoffTargetSchema.extend({
  parts: agentSessionMessageContentFields.parts,
});
export type AgentChatHandoffSendInput = z.infer<typeof agentChatHandoffSendSchema>;

export const agentChatHandoffCheckSchema = z.strictObject({
  chat: agentChatRefSchema,
  submissionId: handoffTargetSchema.shape.submissionId,
  destination: handoffTargetSchema.shape.destination.optional(),
});
export type AgentChatHandoffCheckInput = z.infer<typeof agentChatHandoffCheckSchema>;

export const HANDOFF_ATTEMPT_MISSING = "runtime_handoff_missing";

export const agentChatHandoffResultSchema = sessionOperationObservationSchema.extend({
  kind: z.literal("handoff"),
  submissionId: handoffTargetSchema.shape.submissionId,
  handoff: sessionOperationObservationSchema.shape.handoff.unwrap(),
});
export type AgentChatHandoffResult = z.infer<typeof agentChatHandoffResultSchema>;
