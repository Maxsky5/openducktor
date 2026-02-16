import type { RepoSettingsInput } from "@/types/state-slices";

export const DEFAULT_BRANCH_PREFIX = "obp";

export const parseHookLines = (value: string): string[] =>
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

export const toHookText = (hooks: string[]): string => hooks.join("\n");

export const emptyRepoSettings = (): RepoSettingsInput => ({
  worktreeBasePath: "",
  branchPrefix: DEFAULT_BRANCH_PREFIX,
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
});
