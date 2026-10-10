import { z } from "zod";
import { agentSessionControlSendInputSchema } from "./agent-session-control-schemas";
import { sessionLaunchResultSchema } from "./session-launch-schemas";
import { workspaceSessionSchema } from "./workspace-session-schemas";

export const workspaceSessionLaunchRequestSchema = z.strictObject({
  workspaceId: z.string().min(1),
  repoPath: z.string().min(1),
  sessionId: z.string().min(1),
  parts: agentSessionControlSendInputSchema.shape.parts,
});
export type WorkspaceSessionLaunchRequest = z.infer<typeof workspaceSessionLaunchRequestSchema>;
export const workspaceSessionLaunchResultSchema = sessionLaunchResultSchema.extend({
  sessionId: z.string(),
  record: workspaceSessionSchema.optional(),
});
export type WorkspaceSessionLaunchResult = z.infer<typeof workspaceSessionLaunchResultSchema>;
