import { useQuery } from "@tanstack/react-query";
import type { ResolvedTaskCard } from "@openducktor/workflows";
import type { WorkspaceRef } from "@openducktor/contracts";
import { optionalWorkspaceWorkflowQueryOptions } from "./workflows";

/** Editing uses the workflow of the task. Creation uses the new-task workflow of the workspace. */
export function useTaskFormWorkflow(
  task: ResolvedTaskCard | null,
  scope: WorkspaceRef | null,
  open: boolean,
) {
  const workspace = useQuery({
    ...optionalWorkspaceWorkflowQueryOptions(scope),
    enabled: open && task === null && scope !== null,
  });
  const taskWorkflow = task?.taskWorkflow ?? workspace.data?.newTaskWorkflow;
  const error =
    (task ? null : workspace.error?.message) ??
    (!scope ? "Select the task workspace before editing." : null);
  return {
    taskWorkflow,
    error,
    pending: !error && !taskWorkflow,
    retry: async () => {
      if (!task) await workspace.refetch();
    },
  };
}
