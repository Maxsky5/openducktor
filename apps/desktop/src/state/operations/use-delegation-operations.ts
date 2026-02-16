import { useCallback } from "react";
import { host } from "./host";

type UseDelegationOperationsArgs = {
  activeRepo: string | null;
  refreshTaskData: (repoPath: string) => Promise<void>;
};

type UseDelegationOperationsResult = {
  delegateTask: (taskId: string) => Promise<void>;
  delegateRespond: (
    runId: string,
    action: "approve" | "deny" | "message",
    payload?: string,
  ) => Promise<void>;
  delegateStop: (runId: string) => Promise<void>;
  delegateCleanup: (runId: string, mode: "success" | "failure") => Promise<void>;
};

export function useDelegationOperations({
  activeRepo,
  refreshTaskData,
}: UseDelegationOperationsArgs): UseDelegationOperationsResult {
  const delegateTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      const run = await host.delegateStart(activeRepo, taskId);
      await refreshTaskData(activeRepo);
    },
    [activeRepo, refreshTaskData],
  );

  const delegateRespond = useCallback(
    async (runId: string, action: "approve" | "deny" | "message", payload?: string) => {
      await host.delegateRespond(runId, action, payload);
      if (activeRepo) {
        await refreshTaskData(activeRepo);
      }
    },
    [activeRepo, refreshTaskData],
  );

  const delegateStop = useCallback(
    async (runId: string) => {
      await host.delegateStop(runId);
      if (activeRepo) {
        await refreshTaskData(activeRepo);
      }
    },
    [activeRepo, refreshTaskData],
  );

  const delegateCleanup = useCallback(
    async (runId: string, mode: "success" | "failure") => {
      await host.delegateCleanup(runId, mode);
      if (activeRepo) {
        await refreshTaskData(activeRepo);
      }
    },
    [activeRepo, refreshTaskData],
  );

  return {
    delegateTask,
    delegateRespond,
    delegateStop,
    delegateCleanup,
  };
}
