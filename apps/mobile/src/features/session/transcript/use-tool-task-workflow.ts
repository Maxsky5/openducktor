import { useQuery } from "@tanstack/react-query";
import { taskWorkflowContextQueryOptions } from "@openducktor/frontend-core/queries/task-workflow-context";
import { workspaceWorkflowQueryOptions } from "@openducktor/frontend-core/queries/workflows";
import { useSessionTarget } from "../session-target";

export const useToolTaskWorkflow = (taskId: string | null) => {
  const { workspace: owner } = useSessionTarget();
  const { workspaceId, repoPath } = owner;
  const task = useQuery({
    ...taskWorkflowContextQueryOptions({ workspaceId, repoPath }, taskId ?? ""),
    enabled: taskId !== null,
  });
  const workspace = useQuery({
    ...workspaceWorkflowQueryOptions({ workspaceId, repoPath }),
    enabled: taskId !== null,
  });
  return {
    task: task.data,
    board: workspace.data?.context.board,
    error: task.error?.message ?? workspace.error?.message,
  };
};
