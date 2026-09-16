import type { RepoRuntimeRef } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useCallback } from "react";
import { resolveRequiredDefaultSessionSelection } from "@/features/session-start/session-start-selection";
import { appQueryClient } from "@/lib/query-client";
import { loadRepoRuntimeCatalogFromQuery } from "@/state/queries/runtime-catalog";
import { loadRepoConfigFromQuery, toRepoSettingsInput } from "@/state/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";
import { host } from "../shared/host";
import { requireActiveRepo } from "./task-operations-model";

type RepoRuntimeCatalogLoader = (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;

type UseDelegationOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  loadRepoRuntimeCatalog: RepoRuntimeCatalogLoader;
};

type UseDelegationOperationsResult = {
  delegateTask: (taskId: string) => Promise<void>;
};

export function useDelegationOperations({
  activeWorkspace,
  refreshTaskData,
  loadRepoRuntimeCatalog,
}: UseDelegationOperationsArgs): UseDelegationOperationsResult {
  const delegateTask = useCallback(
    async (taskId: string): Promise<void> => {
      const repo = requireActiveRepo(activeWorkspace?.repoPath ?? null);
      const workspaceId = activeWorkspace?.workspaceId;
      if (!workspaceId) {
        throw new Error("Active workspace is required.");
      }
      await startDelegatedBuild(repo, taskId, workspaceId, loadRepoRuntimeCatalog);
      await refreshTaskData(repo, taskId);
    },
    [activeWorkspace, loadRepoRuntimeCatalog, refreshTaskData],
  );

  return {
    delegateTask,
  };
}

const startDelegatedBuild = async (
  repoPath: string,
  taskId: string,
  workspaceId: string,
  loadRepoRuntimeCatalog: RepoRuntimeCatalogLoader,
): Promise<void> => {
  const repoConfig = await loadRepoConfigFromQuery(appQueryClient, workspaceId);
  const builderSelection = await resolveRequiredDefaultSessionSelection({
    role: "build",
    repoSettings: toRepoSettingsInput(repoConfig),
    repoPath,
    loadRepoRuntimeCatalog: (runtimeRef) =>
      loadRepoRuntimeCatalogFromQuery(appQueryClient, runtimeRef, loadRepoRuntimeCatalog),
  });
  await host.buildStart(repoPath, taskId, builderSelection.runtimeKind);
};
