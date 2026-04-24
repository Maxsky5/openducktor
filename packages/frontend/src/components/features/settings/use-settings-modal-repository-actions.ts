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
      const currentGithub = repoConfig.git.providers.github ?? {
        enabled: false,
        autoDetected: false,
      };
      const hasExistingRepository = Boolean(currentGithub.repository);

      return {
        ...repoConfig,
        git: {
          ...repoConfig.git,
          providers: {
            ...repoConfig.git.providers,
            github: {
              enabled: hasExistingRepository ? currentGithub.enabled : true,
              autoDetected: true,
              repository: detected,
            },
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
