import { useCallback } from "react";
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
};

export function useRepoSettingsOperations({
  activeRepo,
  refreshWorkspaces,
}: UseRepoSettingsOperationsArgs): UseRepoSettingsOperationsResult {
  const toInputDefault = useCallback(
    (
      entry:
        | {
            providerId: string;
            modelId: string;
            variant?: string | undefined;
            opencodeAgent?: string | undefined;
          }
        | null
        | undefined,
    ) => {
      if (!entry) {
        return null;
      }
      return {
        providerId: entry.providerId,
        modelId: entry.modelId,
        variant: entry.variant ?? "",
        opencodeAgent: entry.opencodeAgent ?? "",
      };
    },
    [],
  );

  const toConfigDefault = useCallback(
    (
      entry: {
        providerId: string;
        modelId: string;
        variant: string;
        opencodeAgent: string;
      } | null,
    ) => {
      if (!entry || !entry.providerId.trim() || !entry.modelId.trim()) {
        return undefined;
      }

      return {
        providerId: entry.providerId.trim(),
        modelId: entry.modelId.trim(),
        ...(entry.variant.trim() ? { variant: entry.variant.trim() } : {}),
        ...(entry.opencodeAgent.trim() ? { opencodeAgent: entry.opencodeAgent.trim() } : {}),
      };
    },
    [],
  );

  const loadRepoSettings = useCallback(async (): Promise<RepoSettingsInput> => {
    const repo = requireActiveRepo(activeRepo);

    const config = await host.workspaceGetRepoConfig(repo);
    return {
      worktreeBasePath: config.worktreeBasePath ?? "",
      branchPrefix: config.branchPrefix,
      trustedHooks: config.trustedHooks,
      preStartHooks: config.hooks.preStart,
      postCompleteHooks: config.hooks.postComplete,
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

      await host.workspaceUpdateRepoConfig(repo, {
        worktreeBasePath: normalizedWorktreeBasePath,
        branchPrefix: normalizedBranchPrefix,
        agentDefaults: {
          ...(specDefault ? { spec: specDefault } : {}),
          ...(plannerDefault ? { planner: plannerDefault } : {}),
          ...(buildDefault ? { build: buildDefault } : {}),
          ...(qaDefault ? { qa: qaDefault } : {}),
        },
      });

      await host.workspaceUpdateRepoHooks(repo, {
        preStart: input.preStartHooks,
        postComplete: input.postCompleteHooks,
      });

      if (input.trustedHooks) {
        const challenge = await host.workspacePrepareTrustedHooksChallenge(repo);
        await host.workspaceSetTrustedHooks(repo, true, {
          nonce: challenge.nonce,
          fingerprint: challenge.fingerprint,
        });
      } else {
        await host.workspaceSetTrustedHooks(repo, false);
      }

      await refreshWorkspaces();
    },
    [activeRepo, refreshWorkspaces, toConfigDefault],
  );

  return {
    loadRepoSettings,
    saveRepoSettings,
  };
}
