import {
  resolveSettingsDeepLink,
  type SettingsContentFocusRequest,
  type SettingsDeepLink,
} from "./settings-deep-link";
import type {
  PromptRoleTabId,
  RepositorySectionId,
  SettingsSectionId,
} from "./settings-modal-constants";
import type { SettingsWorkspaceSelectionPolicy } from "./settings-workspace-selection";

export function getOpenState(
  deepLink: SettingsDeepLink | undefined,
  navigation: Navigation,
): OpenState {
  if (!deepLink) {
    return {
      navigation,
      workspaceSelectionPolicy: undefined,
      focusRequest: null,
    };
  }

  const target = resolveSettingsDeepLink(deepLink);
  return {
    navigation: {
      ...navigation,
      ...target.navigation,
    },
    workspaceSelectionPolicy:
      target.scope === "repository" ? target.workspaceSelectionPolicy : undefined,
    focusRequest: target.scope === "repository" ? (target.contentFocus ?? null) : null,
  };
}

export type Navigation = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  globalPromptRoleTab: PromptRoleTabId;
  repoPromptRoleTab: PromptRoleTabId;
  selectedReusablePromptId: string | null;
  selectedCustomAgentRoleId: string | null;
};

export const INITIAL_NAVIGATION: Navigation = {
  section: "repositories",
  repositorySection: "configuration",
  globalPromptRoleTab: "shared",
  repoPromptRoleTab: "shared",
  selectedReusablePromptId: null,
  selectedCustomAgentRoleId: null,
};

type OpenState = {
  navigation: Navigation;
  workspaceSelectionPolicy: SettingsWorkspaceSelectionPolicy | undefined;
  focusRequest: SettingsContentFocusRequest | null;
};
