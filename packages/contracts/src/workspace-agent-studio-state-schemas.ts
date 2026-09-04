import { z } from "zod";
import { agentRoleSchema } from "./agent-workflow-schemas";

export const workspaceAgentStudioActiveTaskSchema = z.object({
  taskId: z.string(),
  role: agentRoleSchema.optional(),
  externalSessionId: z.string().optional(),
});
export type WorkspaceAgentStudioActiveTask = z.infer<typeof workspaceAgentStudioActiveTaskSchema>;

export const workspaceAgentStudioStateSchema = z
  .object({
    openTaskIds: z.array(z.string()),
    activeTask: workspaceAgentStudioActiveTaskSchema.optional(),
  })
  .default({ openTaskIds: [] });
export type WorkspaceAgentStudioState = z.infer<typeof workspaceAgentStudioStateSchema>;
