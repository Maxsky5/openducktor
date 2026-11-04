import type {
  AgentModelFavorite,
  GitProviderRepository,
  SettingsSnapshot,
  SettingsSnapshotRuntimePreview,
  SettingsSnapshotSaveInput,
  WorkspaceRecord,
  WorkspaceRef,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type {
  RepoSettingsInput,
  SettingsSaveOutcome,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { checksQueryKeys } from "@openducktor/frontend-core/queries/checks";
import { repositoryGitProviderContextQueryKeys } from "@openducktor/frontend-core/queries/git-provider-context";
import { invalidateGitlabQueries } from "@openducktor/frontend-core/queries/gitlab";
import { runtimeQueryKeys } from "@openducktor/frontend-core/queries/runtime";
import { getProductionTaskViewSync } from "@openducktor/frontend-core/queries/task-view-sync";
import { customAgentRolesQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import {
  loadRepoConfigFromQuery,
  settingsSnapshotQueryOptions,
  toRepoSettingsInput,
  workspaceQueryKeys,
} from "@openducktor/frontend-core/queries/workspace";
import { diffSettingsSnapshots } from "./settings-snapshot-changes";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

type UseRepoSettingsOperationsArgs = {
  activeWorkspace: WorkspaceRecord | null;
  applyWorkspaceRecords: (records: WorkspaceRecord[]) => void;
};

type UseRepoSettingsOperationsResult = {
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  detectGithubRepository: (scope: WorkspaceRef) => Promise<GitProviderRepository | null>;
  previewSettingsSnapshotRuntime: WorkspaceStateContextValue["previewSettingsSnapshotRuntime"];
  saveSettingsSnapshot: WorkspaceStateContextValue["saveSettingsSnapshot"];
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<AgentModelFavorite[]>;
};

const REPO_CONFIG_QUERY_KEY_PREFIX = [...workspaceQueryKeys.all, "repo-config"] as const;

export function useRepoSettingsOperations({
  activeWorkspace,
  applyWorkspaceRecords,
}: UseRepoSettingsOperationsArgs): UseRepoSettingsOperationsResult {
  const host = useHostClient();
  const queryClient = useQueryClient();
  const settingsSnapshotQueryKey = settingsSnapshotQueryOptions().queryKey;

  const loadRepoSettings = useCallback(async (): Promise<RepoSettingsInput> => {
    const workspaceId = activeWorkspace?.workspaceId;
    if (!workspaceId) {
      throw new Error("Select a workspace first.");
    }

    const config = await loadRepoConfigFromQuery(queryClient, workspaceId);
    return toRepoSettingsInput(config);
  }, [activeWorkspace, queryClient]);

  const detectGithubRepository = useCallback(
    async (scope: WorkspaceRef): Promise<GitProviderRepository | null> => {
      return host.workspaceDetectGithubRepository(scope);
    },
    [host],
  );

  const previewSettingsSnapshotRuntime = useCallback(
    (snapshot: SettingsSnapshotSaveInput): Promise<SettingsSnapshotRuntimePreview> =>
      host.workspacePreviewSettingsSnapshotRuntime(snapshot),
    [host],
  );

  /** Reloads caches that depend on settings after a written save. */
  const refreshAfterSettingsSave = useCallback(
    async (previousSnapshot: SettingsSnapshot | undefined, workspaces: WorkspaceRecord[]) => {
      await queryClient.cancelQueries({ queryKey: settingsSnapshotQueryKey, exact: true });
      const normalizedSnapshot = await queryClient.fetchQuery({
        ...settingsSnapshotQueryOptions(),
        staleTime: 0,
      });
      const changes = diffSettingsSnapshots(previousSnapshot, normalizedSnapshot);
      if (changes.customAgentRolesChanged) {
        await queryClient.invalidateQueries({ queryKey: customAgentRolesQueryOptions().queryKey });
      }
      if (changes.workspacesChanged) {
        await queryClient.invalidateQueries({
          queryKey: REPO_CONFIG_QUERY_KEY_PREFIX,
        });
      }
      if (changes.kanbanDoneVisibleDaysChanged) {
        await getProductionTaskViewSync(queryClient).refreshAfterTaskRetentionChange(workspaces);
      }
      if (changes.agentRuntimesChanged) {
        void queryClient.invalidateQueries({ queryKey: checksQueryKeys.all });
        void queryClient.invalidateQueries({ queryKey: runtimeQueryKeys.definitions() });
      }
      for (const scope of changes.changedGitProviderWorkspaces) {
        void queryClient.resetQueries({
          queryKey: repositoryGitProviderContextQueryKeys.repo(scope),
        });
      }
      // The save deletes a GitLab account that no repository links any more.
      if (changes.changedGitProviderWorkspaces.length > 0)
        void invalidateGitlabQueries(queryClient);
    },
    [queryClient, settingsSnapshotQueryKey],
  );

  const saveSettingsSnapshot = useCallback(
    async (
      snapshot: SettingsSnapshotSaveInput,
      runtimeConfirmation?: string,
    ): Promise<SettingsSaveOutcome> => {
      const previousSnapshot = queryClient.getQueryData<SettingsSnapshot>(settingsSnapshotQueryKey);
      const saveResult = await host.workspaceSaveSettingsSnapshot(snapshot, runtimeConfirmation);
      // Nothing was written. The caller shows the changed impact for a new review.
      if (saveResult.type === "runtime_impact_changed") return saveResult;
      const { workspaces } = saveResult;
      queryClient.setQueryData(workspaceQueryKeys.list(), workspaces);
      applyWorkspaceRecords(workspaces);
      // The host already wrote the settings and applied runtime changes. A failed reload of
      // local caches goes into `refreshError` and does not hide that result.
      const refreshError = await refreshAfterSettingsSave(previousSnapshot, workspaces).then(
        () => null,
        errorMessage,
      );
      return { ...saveResult, refreshError };
    },
    [host, applyWorkspaceRecords, queryClient, refreshAfterSettingsSave, settingsSnapshotQueryKey],
  );

  const saveAgentModelFavorites = useCallback(
    (favorites: AgentModelFavorite[]) => host.workspaceUpdateAgentModelFavorites(favorites),
    [host],
  );

  return {
    loadRepoSettings,
    detectGithubRepository,
    previewSettingsSnapshotRuntime,
    saveSettingsSnapshot,
    saveAgentModelFavorites,
  };
}
