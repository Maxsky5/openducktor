import type {
  GitProviderRepository,
  GlobalGitConfig,
  SettingsSnapshot,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { normalizeRepoScriptsWithTrust } from "@/components/features/settings/settings-model";
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
import { requireActiveRepo } from "../tasks/task-operations-model";

const AGENT_DEFAULT_LABELS = {
  spec: "Specification",
  planner: "Planner",
  build: "Builder",
  qa: "QA",
} as const;

type UseRepoSettingsOperationsArgs = {
  activeRepo: string | null;
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
  activeRepo,
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
          current?.map((entry) => (entry.path === workspace.path ? workspace : entry)) ?? current,
      );
    },
    [queryClient],
  );

  const toConfigDefault = useCallback(
    (role: keyof RepoSettingsInput["agentDefaults"], entry: RepoAgentDefaultInput | null) => {
      if (!entry?.providerId.trim() || !entry.modelId.trim()) {
        return undefined;
      }

      const runtimeKind = entry.runtimeKind?.trim();
      if (!runtimeKind) {
        throw new Error(
          `${AGENT_DEFAULT_LABELS[role]} agent default runtime kind is required when provider and model are configured.`,
        );
      }

      return {
        runtimeKind,
        providerId: entry.providerId.trim(),
        modelId: entry.modelId.trim(),
        ...(entry.variant.trim() ? { variant: entry.variant.trim() } : {}),
        ...(entry.profileId.trim() ? { profileId: entry.profileId.trim() } : {}),
      };
    },
    [],
  );

  const loadRepoSettings = useCallback(async (): Promise<RepoSettingsInput> => {
    const repo = requireActiveRepo(activeRepo);

    const config = await loadRepoConfigFromQuery(queryClient, repo);
    return toRepoSettingsInput(config);
  }, [activeRepo, queryClient]);

  const saveRepoSettings = useCallback(
    async (input: RepoSettingsInput) => {
      const repo = requireActiveRepo(activeRepo);

      const specDefault = toConfigDefault("spec", input.agentDefaults.spec);
      const plannerDefault = toConfigDefault("planner", input.agentDefaults.planner);
      const buildDefault = toConfigDefault("build", input.agentDefaults.build);
      const qaDefault = toConfigDefault("qa", input.agentDefaults.qa);
      const normalizedWorktreeBasePath = input.worktreeBasePath.trim();
      const normalizedBranchPrefix = input.branchPrefix.trim();
      const normalizedTargetBranch = normalizeTargetBranch(input.defaultTargetBranch);
      const { hooks, devServers, trustedHooks } = normalizeRepoScriptsWithTrust(
        {
          hooks: {
            preStart: input.preStartHooks,
            postComplete: input.postCompleteHooks,
          },
          devServers: input.devServers,
        },
        input.trustedHooks,
      );
      const agentDefaults = {
        ...(specDefault ? { spec: specDefault } : {}),
        ...(plannerDefault ? { planner: plannerDefault } : {}),
        ...(buildDefault ? { build: buildDefault } : {}),
        ...(qaDefault ? { qa: qaDefault } : {}),
      };

      const workspace = await host.workspaceSaveRepoSettings(repo, {
        defaultRuntimeKind: input.defaultRuntimeKind,
        worktreeBasePath: normalizedWorktreeBasePath,
        branchPrefix: normalizedBranchPrefix,
        defaultTargetBranch: normalizedTargetBranch,
        trustedHooks,
        hooks,
        devServers,
        worktreeFileCopies: input.worktreeFileCopies.map((f) => f.trim()).filter(Boolean),
        agentDefaults,
      });

      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.repoConfig(repo),
      });
      queryClient.removeQueries({
        queryKey: settingsSnapshotQueryKey,
        exact: true,
      });
      syncWorkspaceListRecord(workspace);
      applyWorkspaceRecord(workspace);
    },
    [
      activeRepo,
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
      queryClient.setQueryData(settingsSnapshotQueryKey, snapshot);
      for (const [repoPath, repoConfig] of Object.entries(snapshot.repos)) {
        queryClient.setQueryData(workspaceQueryKeys.repoConfig(repoPath), repoConfig);
      }
      await queryClient.invalidateQueries({
        queryKey: repoConfigQueryKeyPrefix,
      });
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
