import {
  resolveSettingsDeepLink,
  type SettingsContentFocusRequest,
  type SettingsDeepLink,
  type SettingsDeepLinkResolution,
} from "./settings-deep-link";
import type {
  PromptRoleTabId,
  RepositorySectionId,
  SettingsSectionId,
} from "./settings-modal-constants";

export type SettingsModalNavigationState = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  globalPromptRoleTab: PromptRoleTabId;
  repoPromptRoleTab: PromptRoleTabId;
  selectedReusablePromptId: string | null;
};

export const INITIAL_SETTINGS_MODAL_NAVIGATION: SettingsModalNavigationState = {
  section: "repositories",
  repositorySection: "configuration",
  globalPromptRoleTab: "shared",
  repoPromptRoleTab: "shared",
  selectedReusablePromptId: null,
};

type SettingsModalOpenState = {
  deepLinkResolution: SettingsDeepLinkResolution | null;
  navigation: SettingsModalNavigationState;
  contentFocusRequest: SettingsContentFocusRequest | null;
};

export const resolveSettingsModalOpenState = (
  deepLink: SettingsDeepLink | undefined,
): SettingsModalOpenState => {
  if (!deepLink) {
    return {
      deepLinkResolution: null,
      navigation: INITIAL_SETTINGS_MODAL_NAVIGATION,
      contentFocusRequest: null,
    };
  }

  const deepLinkResolution = resolveSettingsDeepLink(deepLink);
  return {
    deepLinkResolution,
    navigation: {
      ...INITIAL_SETTINGS_MODAL_NAVIGATION,
      ...deepLinkResolution.navigation,
    },
    contentFocusRequest:
      deepLinkResolution.scope === "repository" ? (deepLinkResolution.contentFocus ?? null) : null,
  };
};
