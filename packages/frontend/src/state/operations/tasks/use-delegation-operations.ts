import { useCallback } from "react";
import type { ActiveWorkspace } from "@/types/state-slices";
import { loadRepoDefaultRuntimeKind } from "../agent-orchestrator/runtime/runtime";
import { host } from "../shared/host";
import { requireActiveRepo } from "./task-operations-model";

type UseDelegationOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
};

type UseDelegationOperationsResult = {
  delegateTask: (taskId: string) => Promise<void>;
};

export function useDelegationOperations({
  activeWorkspace,
  refreshTaskData,
}: UseDelegationOperationsArgs): UseDelegationOperationsResult {
  const delegateTask = useCallback(
    async (taskId: string): Promise<void> => {
      const repo = requireActiveRepo(activeWorkspace?.repoPath ?? null);
      const workspaceId = activeWorkspace?.workspaceId;
      if (!workspaceId) {
        throw new Error("Active workspace is required.");
      }
      await startDelegatedBuild(repo, taskId, workspaceId);
      await refreshTaskData(repo, taskId);
    },
    [activeWorkspace, refreshTaskData],
  );

  return {
    delegateTask,
  };
}

const startDelegatedBuild = async (
  repoPath: string,
  taskId: string,
  workspaceId: string,
): Promise<void> => {
  const runtimeKind = await loadRepoDefaultRuntimeKind(workspaceId, "build");
  await host.buildStart(repoPath, taskId, runtimeKind);
};
