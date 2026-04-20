import { describe, expect, test } from "bun:test";
import type { ActiveWorkspace } from "@/types/state-slices";
import { createTaskCardFixture } from "../agent-studio-test-utils";
import {
  resolveAgentStudioGitPanelOpenInTarget,
  resolveTaskWorktreeTaskId,
} from "./use-agents-page-right-panel-model";

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

describe("resolveTaskWorktreeTaskId", () => {
  test("uses the stable tab task id while selected task hydration is still pending", () => {
    expect(
      resolveTaskWorktreeTaskId({
        viewTaskId: "task-24",
        viewSelectedTask: null,
      }),
    ).toBe("task-24");
  });

  test("prefers the hydrated selected task id when available", () => {
    expect(
      resolveTaskWorktreeTaskId({
        viewTaskId: "task-24",
        viewSelectedTask: createTaskCardFixture({ id: "task-24-hydrated" }),
      }),
    ).toBe("task-24-hydrated");
  });
});

describe("resolveAgentStudioGitPanelOpenInTarget", () => {
  test("uses the repository root in repository mode even without a worktree path", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "repository",
        activeWorkspace: createActiveWorkspace("/repo"),
        worktreePath: null,
        fallbackWorktreePath: null,
        sessionWorkingDirectory: null,
        taskWorktreeWorkingDirectory: null,
        isTaskWorktreeResolving: false,
      }),
    ).toEqual({
      path: "/repo",
      disabledReason: null,
    });
  });

  test("uses the builder worktree in worktree mode", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "worktree",
        activeWorkspace: createActiveWorkspace("/repo"),
        worktreePath: "/worktrees/task-24",
        fallbackWorktreePath: null,
        sessionWorkingDirectory: null,
        taskWorktreeWorkingDirectory: null,
        isTaskWorktreeResolving: false,
      }),
    ).toEqual({
      path: "/worktrees/task-24",
      disabledReason: null,
    });
  });

  test("preserves significant leading and trailing spaces in a valid target path", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "repository",
        activeWorkspace: createActiveWorkspace("  /repo with padded name  "),
        worktreePath: null,
        fallbackWorktreePath: null,
        sessionWorkingDirectory: null,
        taskWorktreeWorkingDirectory: null,
        isTaskWorktreeResolving: false,
      }),
    ).toEqual({
      path: "  /repo with padded name  ",
      disabledReason: null,
    });
  });

  test("disables Open In when no worktree-specific path is available", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "worktree",
        activeWorkspace: createActiveWorkspace("/repo"),
        worktreePath: null,
        fallbackWorktreePath: null,
        sessionWorkingDirectory: null,
        taskWorktreeWorkingDirectory: null,
        isTaskWorktreeResolving: false,
      }),
    ).toEqual({
      path: null,
      disabledReason: "Builder worktree path is unavailable. Refresh the Git panel and try again.",
    });
  });

  test("falls back to the active builder working directory before diff worktree resolution completes", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "worktree",
        activeWorkspace: createActiveWorkspace("/repo"),
        worktreePath: null,
        fallbackWorktreePath: null,
        sessionWorkingDirectory: "/repo/.worktrees/task-24",
        taskWorktreeWorkingDirectory: null,
        isTaskWorktreeResolving: false,
      }),
    ).toEqual({
      path: "/repo/.worktrees/task-24",
      disabledReason: null,
    });
  });

  test("does not treat the repo root as a valid builder worktree path", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "worktree",
        activeWorkspace: createActiveWorkspace("/repo"),
        worktreePath: null,
        fallbackWorktreePath: null,
        sessionWorkingDirectory: "/repo",
        taskWorktreeWorkingDirectory: null,
        isTaskWorktreeResolving: false,
      }),
    ).toEqual({
      path: null,
      disabledReason: "Builder worktree path is unavailable. Refresh the Git panel and try again.",
    });
  });

  test("uses the canonical task worktree before direct session fallback", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "worktree",
        activeWorkspace: createActiveWorkspace("/repo"),
        worktreePath: null,
        fallbackWorktreePath: null,
        sessionWorkingDirectory: "/repo/.worktrees/older-task-23",
        taskWorktreeWorkingDirectory: "/repo/.worktrees/task-24",
        isTaskWorktreeResolving: false,
      }),
    ).toEqual({
      path: "/repo/.worktrees/task-24",
      disabledReason: null,
    });
  });

  test("shows a resolving message while task worktree resolution is still loading", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "worktree",
        activeWorkspace: createActiveWorkspace("/repo"),
        worktreePath: null,
        fallbackWorktreePath: null,
        sessionWorkingDirectory: null,
        taskWorktreeWorkingDirectory: null,
        isTaskWorktreeResolving: true,
      }),
    ).toEqual({
      path: null,
      disabledReason: "Resolving builder worktree path...",
    });
  });

  test("uses the fallback worktree path before task hydration catches up", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "worktree",
        activeWorkspace: createActiveWorkspace("/repo"),
        worktreePath: null,
        fallbackWorktreePath: "/repo/.worktrees/task-24",
        sessionWorkingDirectory: "/repo",
        taskWorktreeWorkingDirectory: null,
        isTaskWorktreeResolving: false,
      }),
    ).toEqual({
      path: "/repo/.worktrees/task-24",
      disabledReason: null,
    });
  });
});
