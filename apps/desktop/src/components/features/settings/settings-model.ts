import { DEFAULT_TARGET_BRANCH } from "@/lib/target-branch";
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
  defaultTargetBranch: DEFAULT_TARGET_BRANCH,
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  worktreeSetupScript: "",
  worktreeCleanupScript: "",
  worktreeFileCopies: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  },
});
