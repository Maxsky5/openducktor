import type { BackgroundOperationInvocation } from "@openducktor/host-client";
import type { WorkspaceRef } from "@openducktor/contracts";
import { useCallback } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { errorMessage } from "../../lib/errors";
import { formatTaskAssetFailure, taskAssetFailureFromError } from "./task-asset-failure-recovery";
import { requireActiveRepo } from "./task-operations-model";
import { refreshTaskWorktreeAfterOperation } from "./task-worktree-settlement";

type RunTaskMutationOptions<Result> = {
  run: (repoPath: string, tracking?: BackgroundOperationInvocation) => Promise<Result>;
  background?: {
    workspace: WorkspaceRef;
    taskId: string;
    action: string;
  };
  successTitle?: string;
  successDescription: string;
  failureTitle: string;
};

type UseTaskMutationRunnerArgs = {
  activeRepoPath: string | null;
};

export type TaskMutationRunner = {
  runTaskMutation: <Result>(options: RunTaskMutationOptions<Result>) => Promise<Result>;
};

export function useTaskMutationRunner({
  activeRepoPath,
}: UseTaskMutationRunnerArgs): TaskMutationRunner {
  const { feedback, backgroundOperations, queryClient } = useClientConnection();
  const runTaskMutation = useCallback(
    async <Result>(options: RunTaskMutationOptions<Result>): Promise<Result> => {
      if (options.background) {
        const { workspace, taskId, action } = options.background;
        return backgroundOperations.run(
          { workspace, target: { kind: "task", taskId }, action },
          (tracking) => options.run(workspace.repoPath, tracking),
          (attempt) => refreshTaskWorktreeAfterOperation(queryClient, feedback, attempt),
        );
      }
      try {
        const repoPath = requireActiveRepo(activeRepoPath);
        const result = await options.run(repoPath);
        if (options.successTitle) {
          feedback.show("success", options.successTitle, {
            description: options.successDescription,
          });
        }
        return result;
      } catch (error) {
        const failure = taskAssetFailureFromError(error);
        const description = failure ? formatTaskAssetFailure(failure) : errorMessage(error);
        feedback.show("error", options.failureTitle, { description });
        throw error;
      }
    },
    [activeRepoPath, backgroundOperations, feedback, queryClient],
  );

  return { runTaskMutation };
}
