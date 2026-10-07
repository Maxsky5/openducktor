import { z } from "zod";
import {
  agentSessionControlSummarySchema,
  acceptedAgentUserMessageSchema,
} from "./agent-session-control-schemas";
import { agentSessionLiveSnapshotSchema } from "./agent-session-live-schemas";
import { agentSessionModelSelectionSchema } from "./session-schemas";

export const sessionLaunchStateSchema = z.strictObject({
  launchAttemptId: z.string(),
  workspaceId: z.string(),
  repoPath: z.string(),
  phase: z.enum(["queued", "preparing", "sending", "completed", "failed", "skipped", "canceled"]),
  acceptance: z.enum(["not_submitted", "rejected", "unknown", "accepted"]),
  ownershipSaved: z.boolean(),
  session: agentSessionControlSummarySchema.optional(),
  liveSession: agentSessionLiveSnapshotSchema.optional(),
  model: agentSessionModelSelectionSchema.optional(),
  acceptedMessage: acceptedAgentUserMessageSchema.optional(),
  recoveryAllowed: z.boolean().optional(),
  failure: z
    .strictObject({ message: z.string(), stage: z.string(), cleanupErrors: z.array(z.string()) })
    .optional(),
  skipReason: z.string().optional(),
});
export type SessionLaunchState = z.infer<typeof sessionLaunchStateSchema>;
