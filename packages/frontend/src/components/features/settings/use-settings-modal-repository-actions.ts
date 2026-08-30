import type { GitProviderRepository, RepoConfig } from "@openducktor/contracts";
import { useCallback } from "react";

type UseSettingsModalRepositoryActionsArgs = {
  selectedRepoPath: string | null;
  detectGithubRepository: (repoPath: string) => Promise<GitProviderRepository | null>;
  updateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
};

type SettingsModalRepositoryActions = {
  detectSelectedRepoGithubRepository: () => Promise<GitProviderRepository | null>;
};

export const useSettingsModalRepositoryActions = ({
  selectedRepoPath,
  detectGithubRepository,
  updateSelectedRepoConfig,
}: UseSettingsModalRepositoryActionsArgs): SettingsModalRepositoryActions => {
  const detectSelectedRepoGithubRepository = useCallback(async () => {
    if (!selectedRepoPath) {
      return null;
    }

    const detected = await detectGithubRepository(selectedRepoPath);
    if (!detected) {
      return null;
    }

    updateSelectedRepoConfig((repoConfig) => {
      const currentProvider = repoConfig.git.provider;
      const currentGithub =
        currentProvider?.id === "github"
          ? currentProvider
          : { id: "github" as const, enabled: false, autoDetected: false };
      const hasExistingRepository = Boolean(currentGithub.repository);

      return {
        ...repoConfig,
        git: {
          ...repoConfig.git,
          provider: {
            id: "github",
            enabled: hasExistingRepository ? currentGithub.enabled : true,
            autoDetected: true,
            repository: detected,
          },
        },
      };
    });

    return detected;
  }, [detectGithubRepository, selectedRepoPath, updateSelectedRepoConfig]);

  return {
    detectSelectedRepoGithubRepository,
  };
};
