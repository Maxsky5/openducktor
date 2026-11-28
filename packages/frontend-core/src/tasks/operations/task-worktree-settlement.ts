import type { QueryClient } from "@tanstack/react-query";
import { errorMessage } from "../../lib/errors";
import type { BackgroundAttempt } from "../../operations/background-operation-store";
import type { ClientFeedback } from "../../platform/client-feedback";
import { taskWorktreeQueryKeys } from "../../queries/build-runtime";
import { invalidateTaskWorktreeCleanupImpact } from "../../queries/task-worktree-cleanup-impact";

export function refreshTaskWorktreeAfterOperation(
  queryClient: QueryClient,
  feedback: ClientFeedback,
  { phase, workspace, target }: BackgroundAttempt,
): void {
  if ((phase !== "succeeded" && phase !== "failed") || target.kind !== "task") return;

  const { taskId } = target;
  void Promise.all([
    queryClient.invalidateQueries({
      queryKey: taskWorktreeQueryKeys.taskWorktree({ ...workspace, taskId }),
    }),
    invalidateTaskWorktreeCleanupImpact(queryClient, workspace, taskId),
  ]).catch((cause: unknown) => {
    feedback.show("error", "Could not refresh task details", {
      description: `${workspace.workspaceId} · ${taskId}. ${errorMessage(cause)}`,
    });
  });
}
