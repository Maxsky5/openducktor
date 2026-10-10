import type { WorkflowLaunchRequest, WorkflowLaunchResult } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { taskWorktreeQueryKeys } from "@/state/queries/build-runtime";
import { invalidateTerminalList } from "@/state/queries/terminals";

export const withWorktreeRefresh =
  (
    queryClient: QueryClient,
    launch: (request: WorkflowLaunchRequest) => Promise<WorkflowLaunchResult>,
  ) =>
  async (request: WorkflowLaunchRequest): Promise<WorkflowLaunchResult> => {
    try {
      const outcome = await launch(request);
      await invalidateTerminalList(queryClient, {
        kind: "task",
        repoPath: request.repoPath,
        taskId: request.taskId,
      });
      return outcome;
    } finally {
      // A failed launch can still create a worktree.
      await queryClient
        .invalidateQueries({
          queryKey: taskWorktreeQueryKeys.taskWorktree({
            repoPath: request.repoPath,
            taskId: request.taskId,
          }),
        })
        .catch((cause) => console.error("Cannot refresh the workflow worktree view.", cause));
    }
  };
