import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../agent-studio-test-utils";
import {
  resolveAgentStudioGitPanelOpenInTarget,
  resolveBuildContinuationTargetTaskId,
} from "./use-agents-page-right-panel-model";

describe("resolveBuildContinuationTargetTaskId", () => {
  test("uses the stable tab task id while selected task hydration is still pending", () => {
    expect(
      resolveBuildContinuationTargetTaskId({
        viewTaskId: "task-24",
        viewSelectedTask: null,
      }),
    ).toBe("task-24");
  });

  test("prefers the hydrated selected task id when available", () => {
    expect(
      resolveBuildContinuationTargetTaskId({
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
        activeRepo: "/repo",
        worktreePath: null,
        runWorktreePath: null,
        sessionWorkingDirectory: null,
        continuationTargetWorkingDirectory: null,
        isContinuationTargetResolving: false,
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
        activeRepo: "/repo",
        worktreePath: "/worktrees/task-24",
        runWorktreePath: null,
        sessionWorkingDirectory: null,
        continuationTargetWorkingDirectory: null,
        isContinuationTargetResolving: false,
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
        activeRepo: "  /repo with padded name  ",
        worktreePath: null,
        runWorktreePath: null,
        sessionWorkingDirectory: null,
        continuationTargetWorkingDirectory: null,
        isContinuationTargetResolving: false,
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
        activeRepo: "/repo",
        worktreePath: null,
        runWorktreePath: null,
        sessionWorkingDirectory: null,
        continuationTargetWorkingDirectory: null,
        isContinuationTargetResolving: false,
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
        activeRepo: "/repo",
        worktreePath: null,
        runWorktreePath: null,
        sessionWorkingDirectory: "/repo/.worktrees/task-24",
        continuationTargetWorkingDirectory: null,
        isContinuationTargetResolving: false,
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
        activeRepo: "/repo",
        worktreePath: null,
        runWorktreePath: null,
        sessionWorkingDirectory: "/repo",
        continuationTargetWorkingDirectory: null,
        isContinuationTargetResolving: false,
      }),
    ).toEqual({
      path: null,
      disabledReason: "Builder worktree path is unavailable. Refresh the Git panel and try again.",
    });
  });

  test("uses the canonical continuation target before direct session fallback", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "worktree",
        activeRepo: "/repo",
        worktreePath: null,
        runWorktreePath: null,
        sessionWorkingDirectory: "/repo/.worktrees/older-task-23",
        continuationTargetWorkingDirectory: "/repo/.worktrees/task-24",
        isContinuationTargetResolving: false,
      }),
    ).toEqual({
      path: "/repo/.worktrees/task-24",
      disabledReason: null,
    });
  });

  test("shows a resolving message while continuation target resolution is still loading", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "worktree",
        activeRepo: "/repo",
        worktreePath: null,
        runWorktreePath: null,
        sessionWorkingDirectory: null,
        continuationTargetWorkingDirectory: null,
        isContinuationTargetResolving: true,
      }),
    ).toEqual({
      path: null,
      disabledReason: "Resolving builder worktree path...",
    });
  });

  test("uses the matching run worktree path before task hydration catches up", () => {
    expect(
      resolveAgentStudioGitPanelOpenInTarget({
        contextMode: "worktree",
        activeRepo: "/repo",
        worktreePath: null,
        runWorktreePath: "/repo/.worktrees/task-24",
        sessionWorkingDirectory: "/repo",
        continuationTargetWorkingDirectory: null,
        isContinuationTargetResolving: false,
      }),
    ).toEqual({
      path: "/repo/.worktrees/task-24",
      disabledReason: null,
    });
  });
});
