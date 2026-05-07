import type { GlobalGitConfig } from "@openducktor/contracts";

export const normalizeGlobalGitConfigForSave = (git: GlobalGitConfig): GlobalGitConfig => ({
  defaultMergeMethod: git.defaultMergeMethod,
});
