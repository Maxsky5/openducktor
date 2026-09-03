import type {
  AgentModelFavorite,
  GitProviderRepository,
  GlobalGitConfig,
  RepoAgentDefaults,
  SettingsSnapshot,
  SettingsSnapshotSaveInput,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { normalizeRepoAgentDefaultForSave } from "@/lib/repo-agent-defaults";
import { normalizeTargetBranch } from "@/lib/target-branch";
import { normalizeRepoScripts } from "@/state/read-models/settings-read-model";
import type { RepoAgentDefaultInput, RepoSettingsInput } from "@/types/state-slices";
import { checksQueryKeys } from "../../queries/checks";
import { repositoryGitProviderContextQueryKeys } from "../../queries/git-provider-context";
import { repoTaskDataQueryOptions, taskQueryKeys } from "../../queries/tasks";
import {
  loadRepoConfigFromQuery,
  loadSettingsSnapshotFromQuery,
  settingsSnapshotQueryOptions,
  toRepoSettingsInput,
  workspaceQueryKeys,
} from "../../queries/workspace";
import { host } from "../shared/host";

type UseRepoSettingsOperationsArgs = {
  activeWorkspace: WorkspaceRecord | null;
  applyWorkspaceRecords: (records: WorkspaceRecord[]) => void;
  applyWorkspaceRecord: (record: WorkspaceRecord) => void;
};

type UseRepoSettingsOperationsResult = {
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  saveRepoSettings: (input: RepoSettingsInput) => Promise<void>;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
  detectGithubRepository: (repoPath: string) => Promise<GitProviderRepository | null>;
  saveGlobalGitConfig: (git: GlobalGitConfig) => Promise<void>;
  saveSettingsSnapshot: (snapshot: SettingsSnapshotSaveInput) => Promise<void>;
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<SettingsSnapshot>;
};

const REPO_CONFIG_QUERY_KEY_PREFIX = [...workspaceQueryKeys.all, "repo-config"] as const;

export function useRepoSettingsOperations({
  activeWorkspace,
  applyWorkspaceRecords,
  applyWorkspaceRecord,
}: UseRepoSettingsOperationsArgs): UseRepoSettingsOperationsResult {
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
      const normalizedWorktreeBasePath = input.worktreeBasePath.trim();
      const normalizedBranchPrefix = input.branchPrefix.trim();
      const normalizedTargetBranch = normalizeTargetBranch(input.defaultTargetBranch);
      const { hooks, devServers } = normalizeRepoScripts({
        hooks: {
          preStart: input.preStartHooks,
          postComplete: input.postCompleteHooks,
        },
        devServers: input.devServers,
      });
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
        defaultRuntimeKind: input.defaultRuntimeKind,
        worktreeBasePath: normalizedWorktreeBasePath,
        branchPrefix: normalizedBranchPrefix,
        defaultTargetBranch: normalizedTargetBranch,
        hooks,
        devServers,
        worktreeCopyPaths: input.worktreeCopyPaths.flatMap((path) => {
          const trimmed = path.trim();
          return trimmed ? [trimmed] : [];
        }),
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
      activeWorkspace,
      applyWorkspaceRecord,
      queryClient,
      settingsSnapshotQueryKey,
      syncWorkspaceListRecord,
      toConfigDefault,
    ],
  );

  const loadSettingsSnapshot = useCallback(async (): Promise<SettingsSnapshot> => {
    return loadSettingsSnapshotFromQuery(queryClient);
  }, [queryClient]);

  const detectGithubRepository = useCallback(
    async (repoPath: string): Promise<GitProviderRepository | null> => {
      return host.workspaceDetectGithubRepository(repoPath);
    },
    [],
  );

  const saveGlobalGitConfig = useCallback(
    async (git: GlobalGitConfig): Promise<void> => {
      await host.workspaceUpdateGlobalGitConfig(git);
      await queryClient.cancelQueries({ queryKey: settingsSnapshotQueryKey, exact: true });
      await queryClient.fetchQuery({ ...settingsSnapshotQueryOptions(), staleTime: 0 });
    },
    [queryClient, settingsSnapshotQueryKey],
  );

  const saveSettingsSnapshot = useCallback(
    async (snapshot: SettingsSnapshotSaveInput): Promise<void> => {
      const previousSnapshot = queryClient.getQueryData<SettingsSnapshot>(settingsSnapshotQueryKey);
      const workspaces = await host.workspaceSaveSettingsSnapshot(snapshot);
      await queryClient.cancelQueries({ queryKey: settingsSnapshotQueryKey, exact: true });
      const normalizedSnapshot = await queryClient.fetchQuery({
        ...settingsSnapshotQueryOptions(),
        staleTime: 0,
      });
      await queryClient.invalidateQueries({
        queryKey: REPO_CONFIG_QUERY_KEY_PREFIX,
      });
      queryClient.setQueryData(workspaceQueryKeys.list(), workspaces);
      applyWorkspaceRecords(workspaces);
      const savedActiveWorkspace = workspaces.find((workspace) => workspace.isActive);
      const retentionChanged =
        previousSnapshot !== undefined &&
        previousSnapshot.kanban.doneVisibleDays !== normalizedSnapshot.kanban.doneVisibleDays;
      if (retentionChanged) {
        await queryClient.cancelQueries({ queryKey: taskQueryKeys.all }, { silent: true });
        await queryClient.invalidateQueries({
          queryKey: taskQueryKeys.all,
          refetchType: "none",
        });
        if (savedActiveWorkspace) {
          try {
            await queryClient.fetchQuery({
              ...repoTaskDataQueryOptions(savedActiveWorkspace.repoPath),
              staleTime: 0,
            });
          } catch {
            // TanStack Query keeps the failure for the task-loading error path to report.
          }
        }
      }
      void queryClient.invalidateQueries({ queryKey: checksQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: repositoryGitProviderContextQueryKeys.all });
    },
    [applyWorkspaceRecords, queryClient, settingsSnapshotQueryKey],
  );

  const saveAgentModelFavorites = useCallback(
    async (favorites: AgentModelFavorite[]): Promise<SettingsSnapshot> => {
      const normalizedSnapshot = await host.workspaceUpdateAgentModelFavorites(favorites);
      queryClient.setQueryData(settingsSnapshotQueryKey, normalizedSnapshot);
      return normalizedSnapshot;
    },
    [queryClient, settingsSnapshotQueryKey],
  );

  return {
    loadRepoSettings,
    saveRepoSettings,
    loadSettingsSnapshot,
    detectGithubRepository,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
    saveAgentModelFavorites,
  };
}
