import type {
  GitProviderRepository,
  GlobalGitConfig,
  SettingsSnapshot,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { normalizeRepoScripts } from "@/components/features/settings/settings-model";
import { normalizeRepoAgentDefaultForSave } from "@/lib/repo-agent-defaults";
import { normalizeTargetBranch } from "@/lib/target-branch";
import type { RepoAgentDefaultInput, RepoSettingsInput } from "@/types/state-slices";
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
  saveSettingsSnapshot: (snapshot: SettingsSnapshot) => Promise<void>;
};

export function useRepoSettingsOperations({
  activeWorkspace,
  applyWorkspaceRecords,
  applyWorkspaceRecord,
}: UseRepoSettingsOperationsArgs): UseRepoSettingsOperationsResult {
  const queryClient = useQueryClient();
  const settingsSnapshotQueryKey = settingsSnapshotQueryOptions().queryKey;
  const repoConfigQueryKeyPrefix = [...workspaceQueryKeys.all, "repo-config"] as const;

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
      const agentDefaults = {
        ...(specDefault ? { spec: specDefault } : {}),
        ...(plannerDefault ? { planner: plannerDefault } : {}),
        ...(buildDefault ? { build: buildDefault } : {}),
        ...(qaDefault ? { qa: qaDefault } : {}),
      };

      const workspace = await host.workspaceSaveRepoSettings(workspaceId, {
        defaultRuntimeKind: input.defaultRuntimeKind,
        worktreeBasePath: normalizedWorktreeBasePath,
        branchPrefix: normalizedBranchPrefix,
        defaultTargetBranch: normalizedTargetBranch,
        hooks,
        devServers,
        worktreeCopyPaths: input.worktreeCopyPaths.map((f) => f.trim()).filter(Boolean),
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
      queryClient.setQueryData(
        settingsSnapshotQueryKey,
        (current: SettingsSnapshot | undefined): SettingsSnapshot | undefined =>
          current
            ? {
                ...current,
                git,
              }
            : current,
      );
    },
    [queryClient, settingsSnapshotQueryKey],
  );

  const saveSettingsSnapshot = useCallback(
    async (snapshot: SettingsSnapshot): Promise<void> => {
      const workspaces = await host.workspaceSaveSettingsSnapshot(snapshot);
      queryClient.removeQueries({
        queryKey: settingsSnapshotQueryKey,
        exact: true,
      });
      const normalizedSnapshot = await loadSettingsSnapshotFromQuery(queryClient);
      for (const [workspaceId, repoConfig] of Object.entries(normalizedSnapshot.workspaces)) {
        queryClient.setQueryData(workspaceQueryKeys.repoConfig(workspaceId), repoConfig);
      }
      await queryClient.invalidateQueries({
        queryKey: repoConfigQueryKeyPrefix,
      });
      queryClient.setQueryData(settingsSnapshotQueryKey, normalizedSnapshot);
      queryClient.setQueryData(workspaceQueryKeys.list(), workspaces);
      applyWorkspaceRecords(workspaces);
    },
    [applyWorkspaceRecords, queryClient, repoConfigQueryKeyPrefix, settingsSnapshotQueryKey],
  );

  return {
    loadRepoSettings,
    saveRepoSettings,
    loadSettingsSnapshot,
    detectGithubRepository,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
  };
}
