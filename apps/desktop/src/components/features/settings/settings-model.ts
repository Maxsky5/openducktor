import { DEFAULT_TARGET_BRANCH } from "@/lib/target-branch";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";
import type { RepoSettingsInput } from "@/types/state-slices";

export const DEFAULT_BRANCH_PREFIX = "obp";

export const parseHookLines = (value: string): string[] =>
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

export const toHookText = (hooks: string[]): string => hooks.join("\n");

export const emptyRepoSettings = (): RepoSettingsInput => ({
  defaultRuntimeKind: DEFAULT_RUNTIME_KIND,
  worktreeBasePath: "",
  branchPrefix: DEFAULT_BRANCH_PREFIX,
  defaultTargetBranch: DEFAULT_TARGET_BRANCH,
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  worktreeFileCopies: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  },
});
