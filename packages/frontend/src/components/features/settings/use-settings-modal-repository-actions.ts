import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderConfig,
  type GitProviderRepository,
  type SettingsRepoConfig,
} from "@openducktor/contracts";
import { useCallback } from "react";

type UseSettingsModalRepositoryActionsArgs = {
  selectedRepoPath: string | null;
  detectGithubRepository: (repoPath: string) => Promise<GitProviderRepository | null>;
  updateSelectedRepoConfig: (updater: (current: SettingsRepoConfig) => SettingsRepoConfig) => void;
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
      const configuredProvider = repoConfig.git.provider;
      if (
        configuredProvider !== undefined &&
        configuredProvider.id !== GITHUB_PROVIDER_DESCRIPTOR.id
      ) {
        return repoConfig;
      }
      const currentGithub: GitProviderConfig = configuredProvider ?? {
        id: GITHUB_PROVIDER_DESCRIPTOR.id,
        enabled: false,
        autoDetected: false,
      };
      const hasExistingRepository = Boolean(currentGithub.repository);

      return {
        ...repoConfig,
        git: {
          ...repoConfig.git,
          provider: {
            id: GITHUB_PROVIDER_DESCRIPTOR.id,
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
