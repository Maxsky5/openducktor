import { z } from "zod";
import { agentSessionControlSendInputSchema } from "./agent-session-control-schemas";
import { sessionLaunchStateSchema } from "./session-launch-schemas";
import { workspaceSessionSchema } from "./workspace-session-schemas";

export const workspaceSessionLaunchRefSchema = z.strictObject({
  launchAttemptId: z.string().min(1),
  workspaceId: z.string().min(1),
  repoPath: z.string().min(1),
  sessionId: z.string().min(1),
});
export type WorkspaceSessionLaunchRef = z.infer<typeof workspaceSessionLaunchRefSchema>;
export const workspaceSessionLaunchRequestSchema = workspaceSessionLaunchRefSchema.extend({
  parts: agentSessionControlSendInputSchema.shape.parts,
});
export type WorkspaceSessionLaunchRequest = z.infer<typeof workspaceSessionLaunchRequestSchema>;
export const workspaceSessionLaunchReadSchema = workspaceSessionLaunchRefSchema.extend({
  launchAttemptId: z.string().min(1).optional(),
});
export type WorkspaceSessionLaunchRead = z.infer<typeof workspaceSessionLaunchReadSchema>;
export const workspaceSessionLaunchSnapshotSchema = sessionLaunchStateSchema.extend({
  sessionId: z.string(),
  record: workspaceSessionSchema.optional(),
});
export type WorkspaceSessionLaunchSnapshot = z.infer<typeof workspaceSessionLaunchSnapshotSchema>;
