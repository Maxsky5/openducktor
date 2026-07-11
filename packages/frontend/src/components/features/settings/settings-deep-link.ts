import type { RepositorySectionId, SettingsSectionId } from "./settings-modal-constants";
import type { SettingsWorkspaceSelectionPolicy } from "./settings-workspace-selection";

export type SettingsDeepLink = {
  kind: "repository-dev-servers";
  repositoryPath: string | null;
};

export type SettingsContentFocusRequest = {
  kind: "repository-dev-servers";
};

export type SettingsDeepLinkResolution = {
  navigation: {
    section: SettingsSectionId;
    repositorySection: RepositorySectionId;
  };
  workspaceSelectionPolicy: SettingsWorkspaceSelectionPolicy;
  contentFocus: SettingsContentFocusRequest;
};

export const resolveSettingsDeepLink = (deepLink: SettingsDeepLink): SettingsDeepLinkResolution => {
  switch (deepLink.kind) {
    case "repository-dev-servers":
      return {
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
