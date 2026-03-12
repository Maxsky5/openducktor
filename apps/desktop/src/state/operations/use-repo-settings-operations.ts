import type {
  GitProviderRepository,
  GlobalGitConfig,
  SettingsSnapshot,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { useCallback } from "react";
import { normalizeTargetBranch } from "@/lib/target-branch";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";
import type { RepoSettingsInput } from "@/types/state-slices";
import { host } from "./host";
import { requireActiveRepo } from "./task-operations-model";

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
  const toInputDefault = useCallback(
    (
      entry:
        | {
            runtimeKind?: string;
            providerId: string;
            modelId: string;
            variant?: string | undefined;
            profileId?: string | undefined;
          }
        | null
        | undefined,
    ) => {
      if (!entry) {
        return null;
      }
      return {
        runtimeKind: entry.runtimeKind ?? DEFAULT_RUNTIME_KIND,
        providerId: entry.providerId,
        modelId: entry.modelId,
        variant: entry.variant ?? "",
        profileId: entry.profileId ?? "",
      };
    },
    [],
  );

  const toConfigDefault = useCallback(
    (
      entry: {
        runtimeKind?: string;
        providerId: string;
        modelId: string;
        variant: string;
        profileId: string;
      } | null,
    ) => {
      if (!entry || !entry.providerId.trim() || !entry.modelId.trim()) {
        return undefined;
      }

      const runtimeKind = entry.runtimeKind?.trim() || DEFAULT_RUNTIME_KIND;

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

    const config = await host.workspaceGetRepoConfig(repo);
    return {
      defaultRuntimeKind: config.defaultRuntimeKind,
      worktreeBasePath: config.worktreeBasePath ?? "",
      branchPrefix: config.branchPrefix,
      defaultTargetBranch: normalizeTargetBranch(config.defaultTargetBranch),
      trustedHooks: config.trustedHooks,
      preStartHooks: config.hooks.preStart,
      postCompleteHooks: config.hooks.postComplete,
      worktreeFileCopies: config.worktreeFileCopies ?? [],
      agentDefaults: {
        spec: toInputDefault(config.agentDefaults.spec),
        planner: toInputDefault(config.agentDefaults.planner),
        build: toInputDefault(config.agentDefaults.build),
        qa: toInputDefault(config.agentDefaults.qa),
      },
    };
  }, [activeRepo, toInputDefault]);

  const saveRepoSettings = useCallback(
    async (input: RepoSettingsInput) => {
      const repo = requireActiveRepo(activeRepo);

      const specDefault = toConfigDefault(input.agentDefaults.spec);
      const plannerDefault = toConfigDefault(input.agentDefaults.planner);
      const buildDefault = toConfigDefault(input.agentDefaults.build);
      const qaDefault = toConfigDefault(input.agentDefaults.qa);
      const normalizedWorktreeBasePath = input.worktreeBasePath.trim();
      const normalizedBranchPrefix = input.branchPrefix.trim();
      const normalizedTargetBranch = normalizeTargetBranch(input.defaultTargetBranch);
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
        trustedHooks: input.trustedHooks,
        hooks: {
          preStart: input.preStartHooks,
          postComplete: input.postCompleteHooks,
        },
        worktreeFileCopies: input.worktreeFileCopies.map((f) => f.trim()).filter(Boolean),
        agentDefaults,
      });

      applyWorkspaceRecord(workspace);
    },
    [activeRepo, applyWorkspaceRecord, toConfigDefault],
  );

  const loadSettingsSnapshot = useCallback(async (): Promise<SettingsSnapshot> => {
    return host.workspaceGetSettingsSnapshot();
  }, []);

  const detectGithubRepository = useCallback(
    async (repoPath: string): Promise<GitProviderRepository | null> => {
      return host.workspaceDetectGithubRepository(repoPath);
    },
    [],
  );

  const saveGlobalGitConfig = useCallback(async (git: GlobalGitConfig): Promise<void> => {
    await host.workspaceUpdateGlobalGitConfig(git);
  }, []);

  const saveSettingsSnapshot = useCallback(
    async (snapshot: SettingsSnapshot): Promise<void> => {
      const workspaces = await host.workspaceSaveSettingsSnapshot(snapshot);
      applyWorkspaceRecords(workspaces);
    },
    [applyWorkspaceRecords],
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
