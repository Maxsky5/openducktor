import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useCallback } from "react";
import { resolveRequiredDefaultSessionSelection } from "../../sessions/session-start-selection";
import { loadRuntimeCatalogFromQuery } from "../../queries/runtime-catalog";
import { invalidateTerminalList } from "../../queries/terminals";
import { loadRepoConfigFromQuery, toRepoSettingsInput } from "../../queries/workspace";
import type { ActiveWorkspace } from "../../types/session-slices";
import { requireActiveRepo } from "./task-operations-model";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { connectionHost } from "../../connection/client-connection";

type RepoRuntimeCatalogLoader = (
  runtimeRef: RuntimeWorkingDirectoryRef,
) => Promise<AgentRuntimeCatalog>;

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
  const queryClient = useQueryClient();
  const delegateTask = useCallback(
    async (taskId: string): Promise<void> => {
      const repo = requireActiveRepo(activeWorkspace?.repoPath ?? null);
      const workspaceId = activeWorkspace?.workspaceId;
      if (!workspaceId) {
        throw new Error("Active workspace is required.");
      }
      await startDelegatedBuild(queryClient, repo, taskId, workspaceId, loadRepoRuntimeCatalog);
      await invalidateTerminalList(queryClient, { kind: "task", repoPath: repo, taskId });
      await refreshTaskData(repo, taskId);
    },
    [activeWorkspace, loadRepoRuntimeCatalog, queryClient, refreshTaskData],
  );

  return {
    delegateTask,
  };
}

const startDelegatedBuild = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  workspaceId: string,
  loadRepoRuntimeCatalog: RepoRuntimeCatalogLoader,
): Promise<void> => {
  const repoConfig = await loadRepoConfigFromQuery(queryClient, workspaceId);
  const builderSelection = await resolveRequiredDefaultSessionSelection({
    role: "build",
    repoSettings: toRepoSettingsInput(repoConfig),
    repoPath,
    loadRepoRuntimeCatalog: (runtimeRef) =>
      loadRuntimeCatalogFromQuery(queryClient, runtimeRef, loadRepoRuntimeCatalog),
  });
  await connectionHost(queryClient).buildStart(repoPath, taskId, builderSelection.runtimeKind);
};
