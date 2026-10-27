import { BUILTIN_ROLE_IDS } from "@openducktor/workflows";
import type {
  AgentModelFavorite,
  GitProviderRepository,
  GlobalGitConfig,
  RepoAgentDefaults,
  SettingsSnapshot,
  SettingsSnapshotRuntimePreview,
  SettingsSnapshotSaveInput,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { chatSettingsSchema } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  normalizeRepoAgentDefaultForSave,
  normalizeRepoDefaultModelForSave,
} from "@openducktor/frontend-core/lib/repo-agent-defaults";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { normalizeTargetBranch } from "@openducktor/frontend-core/lib/target-branch";
import { dropBlankLines } from "@/state/read-models/settings-read-model";
import type {
  RepoAgentDefaultInput,
  RepoSettingsInput,
  SettingsSaveOutcome,
  WorkspaceModelDefaultsDraft,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { checksQueryKeys } from "@openducktor/frontend-core/queries/checks";
import { repositoryGitProviderContextQueryKeys } from "@openducktor/frontend-core/queries/git-provider-context";
import { runtimeQueryKeys } from "@openducktor/frontend-core/queries/runtime";
import { getProductionTaskViewSync } from "@openducktor/frontend-core/queries/task-view-sync";
import { customAgentRolesQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import {
  loadRepoConfigFromQuery,
  loadSettingsSnapshotFromQuery,
  settingsSnapshotQueryOptions,
  toRepoSettingsInput,
  workspaceQueryKeys,
} from "@openducktor/frontend-core/queries/workspace";
import { diffSettingsSnapshots } from "./settings-snapshot-changes";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import type { HostClient } from "@openducktor/host-client";

type UseRepoSettingsOperationsArgs = {
  activeWorkspace: WorkspaceRecord | null;
  applyWorkspaceRecords: (records: WorkspaceRecord[]) => void;
  applyWorkspaceRecord: (record: WorkspaceRecord) => void;
};

type UseRepoSettingsOperationsResult = {
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  saveRepoSettings: (input: RepoSettingsInput) => Promise<void>;
  saveWorkspaceModelDefaults: (
    workspaceId: string,
    draft: WorkspaceModelDefaultsDraft,
  ) => Promise<void>;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
  detectGithubRepository: (repoPath: string) => Promise<GitProviderRepository | null>;
  saveGlobalGitConfig: (git: GlobalGitConfig) => Promise<void>;
  previewSettingsSnapshotRuntime: WorkspaceStateContextValue["previewSettingsSnapshotRuntime"];
  saveSettingsSnapshot: WorkspaceStateContextValue["saveSettingsSnapshot"];
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<SettingsSnapshot>;
};

const REPO_CONFIG_QUERY_KEY_PREFIX = [...workspaceQueryKeys.all, "repo-config"] as const;

export function useRepoSettingsOperations({
  activeWorkspace,
  applyWorkspaceRecords,
  applyWorkspaceRecord,
}: UseRepoSettingsOperationsArgs): UseRepoSettingsOperationsResult {
  const host = useHostClient();
  const queryClient = useQueryClient();
  const settingsSnapshotQueryKey = settingsSnapshotQueryOptions().queryKey;

  const syncWorkspaceListRecord = useCallback(
    (workspace: WorkspaceRecord): void => {
      queryClient.setQueryData(
        workspaceQueryKeys.list(),
        (current: WorkspaceRecord[] | undefined) =>
          current?.map((entry) =>
            entry.workspaceId === workspace.workspaceId ? workspace : entry,
          ) ?? current,
      );
    },
    [queryClient],
  );

  const toConfigDefault = useCallback(
    (role: keyof RepoSettingsInput["agentDefaults"], entry: RepoAgentDefaultInput | null) => {
      return normalizeRepoAgentDefaultForSave(role, entry);
    },
    [],
  );

  const loadRepoSettings = useCallback(async (): Promise<RepoSettingsInput> => {
    const workspaceId = activeWorkspace?.workspaceId;
    if (!workspaceId) {
      throw new Error("Select a workspace first.");
    }

    const config = await loadRepoConfigFromQuery(queryClient, workspaceId);
    return toRepoSettingsInput(config);
  }, [activeWorkspace, queryClient]);

  const saveRepoSettings = useCallback(
    async (input: RepoSettingsInput) => {
      const workspaceId = activeWorkspace?.workspaceId;
      if (!workspaceId) {
        throw new Error("Select a workspace first.");
      }

      const specDefault = toConfigDefault("spec", input.agentDefaults.spec);
      const plannerDefault = toConfigDefault("planner", input.agentDefaults.planner);
      const buildDefault = toConfigDefault("build", input.agentDefaults.build);
      const qaDefault = toConfigDefault("qa", input.agentDefaults.qa);
      const defaultModel = normalizeRepoDefaultModelForSave(input.defaultModel);
      const normalizedWorktreeBasePath = input.worktreeBasePath.trim();
      const normalizedBranchPrefix = input.branchPrefix.trim();
      const normalizedTargetBranch = normalizeTargetBranch(input.defaultTargetBranch);
      const agentDefaults: RepoAgentDefaults = {};
      if (specDefault) {
        agentDefaults.spec = specDefault;
      }
      if (plannerDefault) {
        agentDefaults.planner = plannerDefault;
      }
      if (buildDefault) {
        agentDefaults.build = buildDefault;
      }
      if (qaDefault) {
        agentDefaults.qa = qaDefault;
      }

      const workspace = await host.workspaceSaveRepoSettings(workspaceId, {
        defaultModel,
        worktreeBasePath: normalizedWorktreeBasePath,
        branchPrefix: normalizedBranchPrefix,
        defaultTargetBranch: normalizedTargetBranch,
        hooks: { postComplete: dropBlankLines(input.postCompleteHooks) },
        actions: input.actions,
        worktreeCopyPaths: dropBlankLines(input.worktreeCopyPaths),
        agentDefaults,
      });

      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.repoConfig(workspaceId),
      });
      queryClient.removeQueries({
        queryKey: settingsSnapshotQueryKey,
        exact: true,
      });
      syncWorkspaceListRecord(workspace);
      applyWorkspaceRecord(workspace);
    },
    [
      host,
      activeWorkspace,
      applyWorkspaceRecord,
      queryClient,
      settingsSnapshotQueryKey,
      syncWorkspaceListRecord,
      toConfigDefault,
    ],
  );

  const saveWorkspaceModelDefaults = useCallback(
    async (workspaceId: string, draft: WorkspaceModelDefaultsDraft): Promise<void> => {
      const requireComplete = (
        label: string,
        entry: WorkspaceModelDefaultsDraft["defaultModel"],
      ): void => {
        if (entry && (!entry.runtimeKind || !entry.providerId.trim() || !entry.modelId.trim())) {
          throw new Error(
            `${label} needs a runtime and model. Choose a model or clear this choice.`,
          );
        }
      };
      requireComplete("Default Model", draft.defaultModel);
      const agentDefaults: RepoAgentDefaults = {};
      for (const role of BUILTIN_ROLE_IDS) {
        const entry = draft.agentDefaults[role];
        requireComplete(`${role} default`, entry);
        const normalized = normalizeRepoAgentDefaultForSave(role, entry);
        if (normalized) agentDefaults[role] = normalized;
      }
      const defaultModel = normalizeRepoDefaultModelForSave(draft.defaultModel);
      if (!defaultModel && Object.keys(agentDefaults).length === 0) return;

      const update: Parameters<HostClient["workspaceSaveRepoSettings"]>[1] = {};
      if (defaultModel) update.defaultModel = defaultModel;
      if (Object.keys(agentDefaults).length > 0) update.agentDefaults = agentDefaults;
      const workspace = await host.workspaceSaveRepoSettings(workspaceId, update);
      syncWorkspaceListRecord(workspace);
      applyWorkspaceRecord(workspace);
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.repoConfig(workspaceId) });
      queryClient.removeQueries({ queryKey: settingsSnapshotQueryKey, exact: true });
    },
    [host, applyWorkspaceRecord, queryClient, settingsSnapshotQueryKey, syncWorkspaceListRecord],
  );

  const loadSettingsSnapshot = useCallback(async (): Promise<SettingsSnapshot> => {
    return loadSettingsSnapshotFromQuery(queryClient);
  }, [queryClient]);

  const detectGithubRepository = useCallback(
    async (repoPath: string): Promise<GitProviderRepository | null> => {
      return host.workspaceDetectGithubRepository(repoPath);
    },
    [host],
  );

  const saveGlobalGitConfig = useCallback(
    async (git: GlobalGitConfig): Promise<void> => {
      await host.workspaceUpdateGlobalGitConfig(git);
      await queryClient.cancelQueries({ queryKey: settingsSnapshotQueryKey, exact: true });
      await queryClient.fetchQuery({ ...settingsSnapshotQueryOptions(), staleTime: 0 });
    },
    [host, queryClient, settingsSnapshotQueryKey],
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
        await getProductionTaskViewSync(queryClient).refreshAfterTaskRetentionChange(
          workspaces.map((workspace) => workspace.repoPath),
        );
      }
      if (changes.agentRuntimesChanged) {
        void queryClient.invalidateQueries({ queryKey: checksQueryKeys.all });
        void queryClient.invalidateQueries({ queryKey: runtimeQueryKeys.definitions() });
      }
      for (const repoPath of changes.changedGitProviderRepoPaths) {
        void queryClient.resetQueries({
          queryKey: repositoryGitProviderContextQueryKeys.repo(repoPath),
        });
      }
    },
    [queryClient, settingsSnapshotQueryKey],
  );

  const saveSettingsSnapshot = useCallback(
    async (
      snapshot: SettingsSnapshotSaveInput,
      runtimeConfirmation?: string,
    ): Promise<SettingsSaveOutcome> => {
      const previousSnapshot = queryClient.getQueryData<SettingsSnapshot>(settingsSnapshotQueryKey);
      const savedChat = chatSettingsSchema.parse(snapshot.chat);
      const saveResult = await host.workspaceSaveSettingsSnapshot(snapshot, runtimeConfirmation);
      // Nothing was written. The caller shows the changed impact for a new review.
      if (saveResult.type === "runtime_impact_changed") return saveResult;
      await queryClient.cancelQueries({ queryKey: settingsSnapshotQueryKey, exact: true });
      queryClient.setQueryData<SettingsSnapshot>(settingsSnapshotQueryKey, (current) =>
        current ? { ...current, chat: savedChat } : undefined,
      );
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
    async (favorites: AgentModelFavorite[]): Promise<SettingsSnapshot> => {
      const normalizedSnapshot = await host.workspaceUpdateAgentModelFavorites(favorites);
      queryClient.setQueryData(settingsSnapshotQueryKey, normalizedSnapshot);
      return normalizedSnapshot;
    },
    [host, queryClient, settingsSnapshotQueryKey],
  );

  return {
    loadRepoSettings,
    saveRepoSettings,
    saveWorkspaceModelDefaults,
    loadSettingsSnapshot,
    detectGithubRepository,
    saveGlobalGitConfig,
    previewSettingsSnapshotRuntime,
    saveSettingsSnapshot,
    saveAgentModelFavorites,
  };
}
