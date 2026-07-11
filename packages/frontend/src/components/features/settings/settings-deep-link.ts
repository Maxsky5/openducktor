import type { RepositorySectionId, SettingsSectionId } from "./settings-modal-constants";
import type { SettingsWorkspaceSelectionPolicy } from "./settings-workspace-selection";

export type SettingsDeepLink = {
  kind: "repository-dev-servers";
  repositoryPath: string | null;
};

export type SettingsContentFocusRequest = {
  kind: "repository-dev-servers";
};

type GlobalSettingsDeepLinkResolution = {
  scope: "global";
  navigation: {
    section: Exclude<SettingsSectionId, "repositories">;
  };
};

type RepositorySettingsDeepLinkResolution = {
  scope: "repository";
  navigation: {
    section: "repositories";
    repositorySection: RepositorySectionId;
  };
  workspaceSelectionPolicy: SettingsWorkspaceSelectionPolicy;
  contentFocus?: SettingsContentFocusRequest;
};

export type SettingsDeepLinkResolution =
  | GlobalSettingsDeepLinkResolution
  | RepositorySettingsDeepLinkResolution;

export const resolveSettingsDeepLink = (deepLink: SettingsDeepLink): SettingsDeepLinkResolution => {
  switch (deepLink.kind) {
    case "repository-dev-servers":
      return {
        scope: "repository",
        navigation: {
          section: "repositories",
          repositorySection: "scripts",
        },
        workspaceSelectionPolicy: {
          kind: "required",
          repoPath: deepLink.repositoryPath,
        },
        contentFocus: {
          kind: "repository-dev-servers",
        },
      };
  }
};
