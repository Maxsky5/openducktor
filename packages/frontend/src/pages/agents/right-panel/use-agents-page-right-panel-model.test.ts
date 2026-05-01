import { describe, expect, test } from "bun:test";
import {
  resolveBuildToolsOpenInTarget,
  resolveBuildToolsSelectedTaskId,
} from "@/features/agent-studio-build-tools/agent-studio-build-tools-worktree-snapshot";
import { createTaskCardFixture } from "../agent-studio-test-utils";

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
