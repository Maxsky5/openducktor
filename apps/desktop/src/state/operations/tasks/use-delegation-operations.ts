import type { BuildRespondInput } from "@openducktor/adapters-tauri-host";
import { useCallback } from "react";
import { loadRepoDefaultRuntimeKind } from "../agent-orchestrator/runtime/runtime";
import { host } from "../shared/host";
import { requireActiveRepo } from "./task-operations-model";

type UseDelegationOperationsArgs = {
  activeRepo: string | null;
  refreshTaskData: (repoPath: string) => Promise<void>;
};

type UseDelegationOperationsResult = {
  delegateTask: (taskId: string) => Promise<void>;
  delegateRespond: (runId: string, input: BuildRespondInput) => Promise<void>;
  delegateStop: (runId: string) => Promise<void>;
  delegateCleanup: (runId: string, mode: "success" | "failure") => Promise<void>;
};

export function useDelegationOperations({
  activeRepo,
  refreshTaskData,
}: UseDelegationOperationsArgs): UseDelegationOperationsResult {
  const delegateTask = useCallback(
    async (taskId: string): Promise<void> => {
      const repo = requireActiveRepo(activeRepo);
      const runtimeKind = await loadRepoDefaultRuntimeKind(repo, "build");

      await host.buildStart(repo, taskId, runtimeKind);
      await refreshTaskData(repo);
    },
    [activeRepo, refreshTaskData],
  );

  const delegateRespond = useCallback(
    async (runId: string, input: BuildRespondInput) => {
      await host.buildRespond(runId, input);
      if (activeRepo) {
        await refreshTaskData(activeRepo);
      }
    },
    [activeRepo, refreshTaskData],
  );

  const delegateStop = useCallback(
    async (runId: string) => {
      await host.buildStop(runId);
      if (activeRepo) {
        await refreshTaskData(activeRepo);
      }
    },
    [activeRepo, refreshTaskData],
  );

  const delegateCleanup = useCallback(
    async (runId: string, mode: "success" | "failure") => {
      await host.buildCleanup(runId, mode);
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
