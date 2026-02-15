import type { RepoSettingsInput } from "@/types/orchestrator";
import { useCallback } from "react";
import { host } from "./host";

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
  const loadRepoSettings = useCallback(async (): Promise<RepoSettingsInput> => {
    if (!activeRepo) {
      throw new Error("Select a workspace first.");
    }

    const config = await host.workspaceGetRepoConfig(activeRepo);
    return {
      worktreeBasePath: config.worktreeBasePath ?? "",
      branchPrefix: config.branchPrefix,
      trustedHooks: config.trustedHooks,
      preStartHooks: config.hooks.preStart,
      postCompleteHooks: config.hooks.postComplete,
    };
  }, [activeRepo]);

  const saveRepoSettings = useCallback(
    async (input: RepoSettingsInput) => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      await host.workspaceUpdateRepoConfig(activeRepo, {
        worktreeBasePath: input.worktreeBasePath,
        branchPrefix: input.branchPrefix,
        trustedHooks: input.trustedHooks,
        hooks: {
          preStart: input.preStartHooks,
          postComplete: input.postCompleteHooks,
        },
      });

      await refreshWorkspaces();
    },
    [activeRepo, refreshWorkspaces],
  );

  return {
    loadRepoSettings,
    saveRepoSettings,
  };
}
