import type { GlobalGitConfig } from "@openducktor/contracts";

export const prepareGlobalGitSettingsForSave = (git: GlobalGitConfig): GlobalGitConfig => ({
  defaultMergeMethod: git.defaultMergeMethod,
});
