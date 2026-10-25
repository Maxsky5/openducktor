import { describe, expect, test } from "bun:test";
import {
  resolveQueriedBuildWorktreePath,
  resolveTaskExecutionFileExplorerRoot,
  resolveTaskExecutionFileExplorerTargetBranch,
} from "./task-worktree-paths";

describe("resolveQueriedBuildWorktreePath", () => {
  test("says that a task without a worktree gets one when its Builder starts", () => {
    expect(
      resolveQueriedBuildWorktreePath({
        repoPath: "/repo",
        taskId: "task-24",
        queriedWorkingDirectory: null,
      }),
    ).toEqual({
      path: null,
      error: "Task task-24 has no worktree yet. Start the Builder to create one.",
    });
  });

  test("asks for a refresh when the worktree resolves to the repository root", () => {
    expect(
      resolveQueriedBuildWorktreePath({
        repoPath: "/repo",
        taskId: "task-24",
        queriedWorkingDirectory: "/repo",
      }),
    ).toEqual({
      path: null,
      error:
        "Failed to resolve task worktree path for task task-24: Task worktree resolved to the repository root. Use Refresh to retry.",
    });
  });

  test("uses the task worktree", () => {
    expect(
      resolveQueriedBuildWorktreePath({
        repoPath: "/repo",
        taskId: "task-24",
        queriedWorkingDirectory: "/repo/.worktrees/task-24",
      }),
    ).toEqual({ path: "/repo/.worktrees/task-24", error: null });
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
      }),
    ).toEqual({ rootPath: "/repo", unavailableReason: null });
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
