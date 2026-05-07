import { describe, expect, test } from "bun:test";
import type { RepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import { chooseInitialSettingsWorkspaceId } from "./settings-workspace-selection";

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "  /tmp/worktrees  ",
  branchPrefix: "  ",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    providers: {},
  },
  hooks: {
    preStart: [],
    postComplete: [],
  },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

const createSnapshot = (workspaces: SettingsSnapshot["workspaces"]): SettingsSnapshot => ({
  theme: "light",
  git: {
    defaultMergeMethod: "merge_commit",
  },
  general: {
    openAgentStudioTabOnBackgroundSessionStart: true,
  },
  chat: {
    showThinkingMessages: false,
  },
  reusablePrompts: [],
  kanban: {
    doneVisibleDays: 1,
    emptyColumnDisplay: "show",
  },
  autopilot: {
    rules: [],
  },
  workspaces,
  globalPromptOverrides: {},
});

describe("settings workspace selection", () => {
  test("selects initial repo using active repo when available", () => {
    const snapshot = createSnapshot({
      "repo-b": createRepoConfig({
        workspaceId: "repo-b",
        workspaceName: "Repo B",
        repoPath: "/repo-b",
      }),
      "repo-a": createRepoConfig(),
    });

    expect(chooseInitialSettingsWorkspaceId(snapshot, "/repo-b")).toBe("repo-b");
    expect(chooseInitialSettingsWorkspaceId(snapshot, "/missing")).toBe("repo-a");
    expect(chooseInitialSettingsWorkspaceId(createSnapshot({}), null)).toBeNull();
  });
});
