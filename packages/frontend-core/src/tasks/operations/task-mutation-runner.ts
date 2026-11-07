import { useCallback } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { errorMessage } from "../../lib/errors";
import { formatTaskAssetFailure, taskAssetFailureFromError } from "./task-asset-failure-recovery";
import { requireActiveRepo } from "./task-operations-model";

type RunTaskMutationOptions<Result> = {
  run: (repoPath: string) => Promise<Result>;
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
  const { feedback } = useClientConnection();
  const runTaskMutation = useCallback(
    async <Result>(options: RunTaskMutationOptions<Result>): Promise<Result> => {
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
    [activeRepoPath, feedback],
  );

  return { runTaskMutation };
}
