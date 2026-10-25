import { describe, expect, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  createObservedCheckFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type { ChecksStateContextValue } from "@/types/state-slices";
import { buildChecksStateValue, buildWorkspaceStateValue } from "./app-state-context-values";

const workspace = (path: string, isActive = false): WorkspaceRecord => ({
  workspaceId: path.split("/").filter(Boolean).at(-1) ?? "repo",
  workspaceName: path.split("/").filter(Boolean).at(-1) ?? "repo",
  abbreviation: null,
  tileColor: null,
  repoPath: path,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
});

describe("app-state-context-values", () => {
  test("builds workspace context with the provided active workspace", () => {
    const activeWorkspace = workspace("/repo-a", true);
    const value = buildWorkspaceStateValue({
      isSwitchingWorkspace: false,
      closedWorkspaces: [],
      incompleteRemovals: [],
      closeWorkspace: async () => {},
      removeWorkspace: async () => {},
      reopenWorkspace: async () => {},
      resolveWorkspacePath: async () => ({ kind: "new" }),
      isLoadingBranches: false,
      isSwitchingBranch: false,
      branchSyncDegraded: false,
      workspaces: [workspace("/repo-a"), workspace("/repo-b")],
      activeWorkspace,
      branches: [],
      activeBranch: null,
      commitWorkspaceProviderSetup: async () => {
        throw new Error("Not used");
      },
      addWorkspace: async () => {
        throw new Error("Not used");
      },
      saveWorkspaceModelDefaults: async () => {
        throw new Error("Not used");
      },
      selectWorkspace: async () => {},
      reorderWorkspaces: async () => {},
      refreshBranches: async () => {},
      switchBranch: async () => {},
      loadRepoSettings: async () => ({
        worktreeBasePath: "",
        branchPrefix: "odt",
        defaultModel: null,
        defaultTargetBranch: { remote: "origin", branch: "main" },
        postCompleteHooks: [],
        actions: { items: [], defaultActionId: null },
        worktreeCopyPaths: [],
        agentDefaults: { spec: null, planner: null, build: null, qa: null },
      }),
      saveRepoSettings: async () => {},
      loadSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      detectGithubRepository: async () => null,
      saveGlobalGitConfig: async () => {},
      previewSettingsSnapshotRuntime: async () => ({ impact: null }),
      saveSettingsSnapshot: async () => ({
        type: "saved" as const,
        workspaces: [],
        runtimeApplications: [],
        refreshError: null,
      }),
      saveAgentModelFavorites: async () => {
        throw new Error("saveAgentModelFavorites is not used in this test");
      },
    });

    expect(value.activeWorkspace).toEqual(activeWorkspace);
  });

  test("returns identity for the checks context builder", () => {
    const checksValue: ChecksStateContextValue = {
      pathCheck: createObservedCheckFixture(),
      gitCheck: createObservedCheckFixture(),
      checksRepoPath: null,
      taskStoreCheck: createObservedCheckFixture(),
      isRefreshingChecks: false,
      refreshChecks: async () => {},
    };
    expect(buildChecksStateValue(checksValue)).toBe(checksValue);
  });
});
