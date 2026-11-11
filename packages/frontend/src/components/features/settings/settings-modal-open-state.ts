import { PROMPT_HOME_VIEW, type PromptView } from "./settings-prompt-owners";
import {
  resolveSettingsDeepLink,
  type SettingsContentFocusRequest,
  type SettingsDeepLink,
} from "./settings-deep-link";
import type { RepositorySectionId, SettingsSectionId } from "./settings-modal-constants";
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
    focusRequest: target.contentFocus ?? null,
  };
}

export type Navigation = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  /** The open screen of System prompts. */
  globalPromptView: PromptView;
  /** The open screen of Repository prompts. */
  repoPromptView: PromptView;
  selectedReusablePromptId: string | null;
  selectedCustomAgentRoleId: string | null;
};

export const INITIAL_NAVIGATION: Navigation = {
  section: "repositories",
  repositorySection: "configuration",
  globalPromptView: PROMPT_HOME_VIEW,
  repoPromptView: PROMPT_HOME_VIEW,
  selectedReusablePromptId: null,
  selectedCustomAgentRoleId: null,
};

type OpenState = {
  navigation: Navigation;
  workspaceSelectionPolicy: SettingsWorkspaceSelectionPolicy | undefined;
  focusRequest: SettingsContentFocusRequest | null;
};
