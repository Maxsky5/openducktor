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

export const workspaceAgentStudioStateActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ensure_tab"), taskId: z.string() }),
  z.object({
    type: z.literal("change_tabs"),
    baseOpenTaskIds: z.array(z.string()),
    openTaskIds: z.array(z.string()),
    activeTaskId: z.string().nullable(),
  }),
  z.object({
    type: z.literal("set_active_task"),
    activeTask: workspaceAgentStudioActiveTaskSchema.nullable(),
  }),
  z.object({
    type: z.literal("sync_snapshot"),
    baseOpenTaskIds: z.array(z.string()),
    openTaskIds: z.array(z.string()),
    activeTask: workspaceAgentStudioActiveTaskSchema.nullable(),
  }),
]);
export type WorkspaceAgentStudioStateAction = z.infer<typeof workspaceAgentStudioStateActionSchema>;
