import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderConfig,
  type GitProviderRepository,
  type SettingsRepoConfig,
  type WorkspaceRef,
} from "@openducktor/contracts";
import { useCallback } from "react";

type UseSettingsModalRepositoryActionsArgs = {
  selectedWorkspace: WorkspaceRef | null;
  detectGithubRepository: (workspace: WorkspaceRef) => Promise<GitProviderRepository | null>;
  updateSelectedRepoConfig: (updater: (current: SettingsRepoConfig) => SettingsRepoConfig) => void;
};

type SettingsModalRepositoryActions = {
  detectSelectedRepoGithubRepository: () => Promise<GitProviderRepository | null>;
};

export const useSettingsModalRepositoryActions = ({
  selectedWorkspace,
  detectGithubRepository,
  updateSelectedRepoConfig,
}: UseSettingsModalRepositoryActionsArgs): SettingsModalRepositoryActions => {
  const detectSelectedRepoGithubRepository = useCallback(async () => {
    if (!selectedWorkspace) {
      return null;
    }

    const detected = await detectGithubRepository(selectedWorkspace);
    if (!detected) {
      return null;
    }

    updateSelectedRepoConfig((repoConfig) => {
      if (
        repoConfig.workspaceId !== selectedWorkspace.workspaceId ||
        repoConfig.repoPath !== selectedWorkspace.repoPath
      )
        return repoConfig;
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
  }, [detectGithubRepository, selectedWorkspace, updateSelectedRepoConfig]);

  return {
    detectSelectedRepoGithubRepository,
  };
};
