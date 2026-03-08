import type { SettingsSnapshot } from "@openducktor/contracts";
import { useCallback } from "react";
import { normalizeCanonicalTargetBranch } from "@/lib/target-branch";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";
import type { RepoSettingsInput } from "@/types/state-slices";
import { host } from "./host";
import { requireActiveRepo } from "./task-operations-model";

type UseRepoSettingsOperationsArgs = {
  activeRepo: string | null;
  refreshWorkspaces: () => Promise<void>;
};

type UseRepoSettingsOperationsResult = {
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  saveRepoSettings: (input: RepoSettingsInput) => Promise<void>;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
  saveSettingsSnapshot: (snapshot: SettingsSnapshot) => Promise<void>;
};

export function useRepoSettingsOperations({
  activeRepo,
  refreshWorkspaces,
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
      defaultTargetBranch: normalizeCanonicalTargetBranch(config.defaultTargetBranch),
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
      const normalizedTargetBranch = normalizeCanonicalTargetBranch(input.defaultTargetBranch);
      const agentDefaults = {
        ...(specDefault ? { spec: specDefault } : {}),
        ...(plannerDefault ? { planner: plannerDefault } : {}),
        ...(buildDefault ? { build: buildDefault } : {}),
        ...(qaDefault ? { qa: qaDefault } : {}),
      };

      await host.workspaceSaveRepoSettings(repo, {
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

      await refreshWorkspaces();
    },
    [activeRepo, refreshWorkspaces, toConfigDefault],
  );

  const loadSettingsSnapshot = useCallback(async (): Promise<SettingsSnapshot> => {
    return host.workspaceGetSettingsSnapshot();
  }, []);

  const saveSettingsSnapshot = useCallback(
    async (snapshot: SettingsSnapshot): Promise<void> => {
      await host.workspaceSaveSettingsSnapshot(snapshot);
      await refreshWorkspaces();
    },
    [refreshWorkspaces],
  );

  return {
    loadRepoSettings,
    saveRepoSettings,
    loadSettingsSnapshot,
    saveSettingsSnapshot,
  };
}
