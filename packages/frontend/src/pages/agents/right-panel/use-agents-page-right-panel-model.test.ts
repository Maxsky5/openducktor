import { describe, expect, test } from "bun:test";
import {
  resolveBuildToolsOpenInTarget,
  resolveBuildToolsSelectedTaskId,
} from "@/features/agent-studio-build-tools/agent-studio-build-tools-worktree-snapshot";
import type { DiffDataState } from "@/features/agent-studio-git";
import {
  INVALID_TASK_TARGET_BRANCH_LABEL,
  resolveTaskTargetBranchState,
} from "@/lib/target-branch";
import { createTaskCardFixture } from "../agent-studio-test-utils";
import {
  buildAgentsPageDiffModel,
  resolveTaskExecutionFileExplorerRoot,
  resolveTaskExecutionFileExplorerTargetBranch,
} from "./use-agents-page-right-panel-model";

type BuildDiffModelArgs = Parameters<typeof buildAgentsPageDiffModel>[0];

const refreshDiff = async (_mode?: string): Promise<void> => {};

const createEmptyScopeState = (): DiffDataState["scopeStatesByScope"]["target"] => ({
  branch: null,
  gitConflict: null,
  fileDiffs: [],
  fileStatuses: [],
  uncommittedFileCount: 0,
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  error: null,
  hashVersion: null,
  statusHash: null,
  diffHash: null,
});

const createDiffData = (): DiffDataState => ({
  branch: "main",
  worktreePath: "/repo",
  targetBranch: "origin/main",
  diffScope: "uncommitted",
  gitConflict: null,
  scopeStatesByScope: {
    target: createEmptyScopeState(),
    uncommitted: createEmptyScopeState(),
  },
  loadedScopesByScope: { target: false, uncommitted: false },
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  fileDiffs: [],
  fileStatuses: [],
  statusSnapshotKey: null,
  hashVersion: null,
  statusHash: null,
  diffHash: null,
  uncommittedFileCount: 0,
  isLoading: false,
  error: null,
  refresh: refreshDiff,
  setDiffScope: () => {},
});

const createGitActions = (
  overrides: Partial<BuildDiffModelArgs["gitActions"]> = {},
): BuildDiffModelArgs["gitActions"] =>
  ({
    isGitActionsLocked: false,
    gitActionsLockReason: null,
    showLockReasonBanner: false,
    ...overrides,
  }) as BuildDiffModelArgs["gitActions"];

describe("resolveBuildToolsSelectedTaskId", () => {
  test("uses the stable tab task id while selected task hydration is still pending", () => {
    expect(
      resolveBuildToolsSelectedTaskId({
        viewTaskId: "task-24",
        viewSelectedTaskId: null,
      }),
    ).toBe("task-24");
  });

  test("prefers the hydrated selected task id when available", () => {
    expect(
      resolveBuildToolsSelectedTaskId({
        viewTaskId: "task-24",
        viewSelectedTaskId: createTaskCardFixture({ id: "task-24-hydrated" }).id,
      }),
    ).toBe("task-24-hydrated");
  });
});

describe("resolveTaskExecutionFileExplorerRoot", () => {
  test("uses the canonical task worktree in worktree mode", () => {
    expect(
      resolveTaskExecutionFileExplorerRoot({
        workspaceRepoPath: "/repo",
        contextMode: "worktree",
        worktreePath: "/repo/.worktrees/task-24",
        isWorktreeResolving: false,
        worktreeError: null,
        targetBranchValidationError: null,
      }),
    ).toEqual({ rootPath: "/repo/.worktrees/task-24", unavailableReason: null });
  });

  test("does not fall back to the repository while the task worktree is resolving", () => {
    expect(
      resolveTaskExecutionFileExplorerRoot({
        workspaceRepoPath: "/repo",
        contextMode: "worktree",
        worktreePath: null,
        isWorktreeResolving: true,
        worktreeError: null,
        targetBranchValidationError: null,
      }),
    ).toEqual({ rootPath: null, unavailableReason: "Resolving task worktree..." });
  });

  test("uses the repository root in repository mode", () => {
    expect(
      resolveTaskExecutionFileExplorerRoot({
        workspaceRepoPath: "/repo",
        contextMode: "repository",
        worktreePath: "/repo/.worktrees/task-24",
        isWorktreeResolving: false,
        worktreeError: null,
        targetBranchValidationError: null,
      }),
    ).toEqual({ rootPath: "/repo", unavailableReason: null });
  });

  test("surfaces invalid task target branches before resolving a worktree", () => {
    const validationError = "Invalid openducktor.targetBranch metadata.";

    expect(
      resolveTaskExecutionFileExplorerRoot({
        workspaceRepoPath: "/repo",
        contextMode: "worktree",
        worktreePath: "/repo/.worktrees/task-24",
        isWorktreeResolving: false,
        worktreeError: null,
        targetBranchValidationError: validationError,
      }),
    ).toEqual({ rootPath: null, unavailableReason: validationError });
  });
});

describe("resolveTaskExecutionFileExplorerTargetBranch", () => {
  test("omits the upstream comparison when the repository branch is not tracking", () => {
    expect(
      resolveTaskExecutionFileExplorerTargetBranch({
        contextMode: "repository",
        targetBranch: "@{upstream}",
        upstreamStatus: "untracked",
        hasLoadedRepositoryStatus: true,
        targetBranchValidationError: null,
      }),
    ).toBeNull();
  });

  test("omits the upstream comparison until repository tracking has loaded", () => {
    expect(
      resolveTaskExecutionFileExplorerTargetBranch({
        contextMode: "repository",
        targetBranch: "@{upstream}",
        upstreamStatus: "tracking",
        hasLoadedRepositoryStatus: false,
        targetBranchValidationError: null,
      }),
    ).toBeNull();
  });

  test("keeps the task target branch in worktree mode", () => {
    expect(
      resolveTaskExecutionFileExplorerTargetBranch({
        contextMode: "worktree",
        targetBranch: "origin/main",
        upstreamStatus: "untracked",
        hasLoadedRepositoryStatus: false,
        targetBranchValidationError: null,
      }),
    ).toBe("origin/main");
  });

  test("omits comparisons for invalid worktree target branches", () => {
    expect(
      resolveTaskExecutionFileExplorerTargetBranch({
        contextMode: "worktree",
        targetBranch: "origin/main",
        upstreamStatus: "untracked",
        hasLoadedRepositoryStatus: false,
        targetBranchValidationError: "Invalid task target branch.",
      }),
    ).toBeNull();
  });
});

describe("resolveBuildToolsOpenInTarget", () => {
  test("uses the repository root in repository mode even without a worktree path", () => {
    expect(
      resolveBuildToolsOpenInTarget({
        contextMode: "repository",
        repoPath: "/repo",
        worktreePath: null,
        queriedWorktreePath: null,
        sessionWorkingDirectory: null,
        isWorktreeResolving: false,
      }),
    ).toEqual({
      path: "/repo",
      disabledReason: null,
    });
  });

  test("uses the builder worktree in worktree mode", () => {
    expect(
      resolveBuildToolsOpenInTarget({
        contextMode: "worktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/task-24",
        queriedWorktreePath: null,
        sessionWorkingDirectory: null,
        isWorktreeResolving: false,
      }),
    ).toEqual({
      path: "/worktrees/task-24",
      disabledReason: null,
    });
  });

  test("preserves significant leading and trailing spaces in a valid target path", () => {
    expect(
      resolveBuildToolsOpenInTarget({
        contextMode: "repository",
        repoPath: "  /repo with padded name  ",
        worktreePath: null,
        queriedWorktreePath: null,
        sessionWorkingDirectory: null,
        isWorktreeResolving: false,
      }),
    ).toEqual({
      path: "  /repo with padded name  ",
      disabledReason: null,
    });
  });

  test("disables Open In when no worktree-specific path is available", () => {
    expect(
      resolveBuildToolsOpenInTarget({
        contextMode: "worktree",
        repoPath: "/repo",
        worktreePath: null,
        queriedWorktreePath: null,
        sessionWorkingDirectory: null,
        isWorktreeResolving: false,
      }),
    ).toEqual({
      path: null,
      disabledReason: "Builder worktree path is unavailable. Refresh the Git panel and try again.",
    });
  });

  test("falls back to the active builder working directory before diff worktree resolution completes", () => {
    expect(
      resolveBuildToolsOpenInTarget({
        contextMode: "worktree",
        repoPath: "/repo",
        worktreePath: null,
        queriedWorktreePath: null,
        sessionWorkingDirectory: "/repo/.worktrees/task-24",
        isWorktreeResolving: false,
      }),
    ).toEqual({
      path: "/repo/.worktrees/task-24",
      disabledReason: null,
    });
  });

  test("does not treat the repo root as a valid builder worktree path", () => {
    expect(
      resolveBuildToolsOpenInTarget({
        contextMode: "worktree",
        repoPath: "/repo",
        worktreePath: null,
        queriedWorktreePath: null,
        sessionWorkingDirectory: "/repo",
        isWorktreeResolving: false,
      }),
    ).toEqual({
      path: null,
      disabledReason: "Builder worktree path is unavailable. Refresh the Git panel and try again.",
    });
  });

  test("uses the canonical task worktree before direct session fallback", () => {
    expect(
      resolveBuildToolsOpenInTarget({
        contextMode: "worktree",
        repoPath: "/repo",
        worktreePath: null,
        queriedWorktreePath: "/repo/.worktrees/task-24",
        sessionWorkingDirectory: "/repo/.worktrees/older-task-23",
        isWorktreeResolving: false,
      }),
    ).toEqual({
      path: "/repo/.worktrees/task-24",
      disabledReason: null,
    });
  });

  test("shows a resolving message while task worktree resolution is still loading", () => {
    expect(
      resolveBuildToolsOpenInTarget({
        contextMode: "worktree",
        repoPath: "/repo",
        worktreePath: null,
        queriedWorktreePath: null,
        sessionWorkingDirectory: null,
        isWorktreeResolving: true,
      }),
    ).toEqual({
      path: null,
      disabledReason: "Resolving builder worktree path...",
    });
  });

  test("uses the fallback worktree path before task hydration catches up", () => {
    expect(
      resolveBuildToolsOpenInTarget({
        contextMode: "worktree",
        repoPath: "/repo",
        worktreePath: "/repo/.worktrees/task-24",
        queriedWorktreePath: null,
        sessionWorkingDirectory: "/repo",
        isWorktreeResolving: false,
      }),
    ).toEqual({
      path: "/repo/.worktrees/task-24",
      disabledReason: null,
    });
  });
});

describe("buildAgentsPageDiffModel", () => {
  test("locks git actions from snapshot target-branch validation", () => {
    const validationError = "Invalid openducktor.targetBranch metadata: missing field `branch`.";
    const diffModel = buildAgentsPageDiffModel({
      branches: [],
      buildToolsSnapshot: {
        diffData: createDiffData(),
        gitPanelContextMode: "repository",
        openInTarget: { path: "/repo", disabledReason: null },
        resolvedGitPanelBranch: "main",
        targetBranchState: resolveTaskTargetBranchState({
          taskTargetBranch: null,
          taskTargetBranchError: validationError,
          defaultTargetBranch: null,
        }),
      },
      gitActions: createGitActions(),
      selectedTask: createTaskCardFixture({
        id: "task-24",
        targetBranchError: validationError,
      }),
      detectingPullRequestTaskId: null,
      onDetectPullRequest: () => {},
    });

    expect(diffModel.targetBranch).toBe(INVALID_TASK_TARGET_BRANCH_LABEL);
    expect(diffModel.isGitActionsLocked).toBe(true);
    expect(diffModel.gitActionsLockReason).toBe(validationError);
    expect(diffModel.showLockReasonBanner).toBe(true);
  });
});
