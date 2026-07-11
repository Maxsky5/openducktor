import type {
  PromptRoleTabId,
  RepositorySectionId,
  SettingsSectionId,
} from "./settings-modal-constants";

export type SettingsModalOpenTarget = {
  repositoryPath: string | null;
  repositorySection: "scripts";
  anchor: "dev-servers";
};

export type SettingsModalNavigationState = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  globalPromptRoleTab: PromptRoleTabId;
  repoPromptRoleTab: PromptRoleTabId;
  selectedReusablePromptId: string | null;
};

export const applySettingsModalOpenTarget = (
  current: SettingsModalNavigationState,
  target: SettingsModalOpenTarget,
): SettingsModalNavigationState => ({
  ...current,
  section: "repositories",
  repositorySection: target.repositorySection,
});
