import { describe, expect, test } from "bun:test";
import {
  buildTaskCloseConfirmCopy,
  buildTaskDeleteConfirmCopy,
  buildTaskResetConfirmCopy,
  buildTaskResetImplementationConfirmCopy,
  type TaskConfirmCopy,
  type TaskResetImplementationCopyInput,
  taskResetImplementationConfirmState,
  taskStopImpactLine,
} from "./task-confirm-copy";
import type { TaskConfirmImpact } from "./task-confirm-dialog-types";

const impact = (overrides: Partial<TaskConfirmImpact> = {}): TaskConfirmImpact => ({
  isLoading: false,
  isLoadingStopImpact: false,
  hasManagedSessionCleanup: false,
  managedWorktreeCount: 0,
  terminalCount: 0,
  activeSessionCount: 0,
  activeSessionCountError: null,
  error: null,
  ...overrides,
});

const texts = (copy: TaskConfirmCopy): string[] => copy.lines.map((line) => line.text);

describe("taskStopImpactLine", () => {
  test("names a failed stop preview as an error line", () => {
    expect(taskStopImpactLine(null, "host unavailable", "close")).toEqual({
      text: "Unable to check how many active sessions will be stopped: host unavailable",
      emphasis: false,
      error: true,
    });
  });

  test("states the active sessions that stop, and nothing when none stop", () => {
    expect(taskStopImpactLine(2, null, "delete")?.text).toBe(
      "2 active agent sessions will be stopped before deletion.",
    );
    expect(taskStopImpactLine(0, null, "delete")).toBeNull();
    expect(taskStopImpactLine(null, null, "delete")).toBeNull();
  });
});

describe("buildTaskCloseConfirmCopy", () => {
  test("states what Close Task keeps and removes, in display order", () => {
    const copy = buildTaskCloseConfirmCopy(
      { id: "ODT-1", title: "Ship the release" },
      impact({ terminalCount: 1, activeSessionCount: 1, isLoadingStopImpact: true }),
    );
    expect(copy.title).toBe("Close Task");
    expect(copy.description).toBe("Close “Ship the release” (ODT-1) manually and move it to Done?");
    expect(copy.descriptionSegments).toEqual([
      { text: "Close “", emphasis: false },
      { text: "Ship the release", emphasis: true },
      { text: "” (ODT-1) manually and move it to Done?", emphasis: false },
    ]);
    expect(copy.tone).toBe("warning");
    expect(copy.lines[0]?.emphasis).toBe(true);
    expect(texts(copy)).toEqual([
      "This manual override moves the task to Done and bypasses unfinished workflow steps.",
      "No code is merged and no pull request is created, updated, or merged.",
      "1 task terminal, including action terminals, will be stopped before the task closes.",
      "1 active agent session will be stopped before closing.",
      "Checking active agent sessions before closing.",
      "Linked task worktrees and related local branches will be deleted when present. Any uncommitted changes in those worktrees will be lost.",
      "The task record, all artifacts, and linked history are retained. Free artifacts become read-only.",
    ]);
    expect(copy.confirmLabel).toEqual({
      idle: "Close task",
      pending: "Closing...",
      checking: "Checking...",
    });
  });

  test("says that no terminal stops when the task has none", () => {
    expect(texts(buildTaskCloseConfirmCopy({ id: "ODT-1", title: "Ship" }, impact()))[2]).toBe(
      "No running task terminals will be stopped.",
    );
  });
});

describe("buildTaskResetConfirmCopy", () => {
  test("states what Reset Task clears and keeps", () => {
    const copy = buildTaskResetConfirmCopy(
      { id: "ODT-2", title: "Fix login" },
      impact({ terminalCount: 2, hasManagedSessionCleanup: true, managedWorktreeCount: 1 }),
    );
    expect(copy.title).toBe("Reset Task");
    expect(copy.description).toBe(
      "Reset “Fix login” (ODT-2) back to Backlog? This permanently clears all task artifacts.",
    );
    expect(copy.tone).toBe("destructive");
    expect(texts(copy)).toEqual([
      "This action moves the task back to Backlog and keeps the task record itself.",
      "All workflow and free artifacts will be removed.",
      "Linked spec, planner, builder, and QA sessions will be removed.",
      "Linked pull request and direct-merge metadata will be cleared.",
      "2 associated terminals will be terminated before the task resets.",
      "1 linked task worktree and its related local branch will also be deleted. Any uncommitted changes in that worktree will be lost.",
    ]);
    expect(copy.confirmLabel.idle).toBe("Reset task");
  });
});

describe("buildTaskDeleteConfirmCopy", () => {
  test("names the task in the description", () => {
    const copy = buildTaskDeleteConfirmCopy({ id: "ODT-3", title: "Login" }, impact());
    expect(copy.description).toBe("Delete “Login” (ODT-3)? This cannot be undone.");
    expect(texts(copy)).toEqual([
      "This action permanently removes the task and all its workflow and free artifacts.",
    ]);
  });

  test("names the cleanup impact of the task", () => {
    const copy = buildTaskDeleteConfirmCopy(
      { id: "ODT-4", title: null },
      impact({ terminalCount: 1, activeSessionCountError: "boom", isLoading: true }),
    );
    expect(copy.description).toBe("Delete ODT-4? This cannot be undone.");
    expect(copy.descriptionSegments).toEqual([
      { text: "Delete ODT-4? This cannot be undone.", emphasis: false },
    ]);
    expect(texts(copy)).toEqual([
      "This action permanently removes the task and all its workflow and free artifacts.",
      "1 associated terminal will be terminated before deletion.",
      "Unable to check how many active sessions will be stopped: boom",
      "Checking linked task worktree cleanup impact before deletion.",
    ]);
    expect(copy.lines[2]?.error).toBe(true);
    expect(copy.confirmLabel).toEqual({
      idle: "Delete",
      pending: "Deleting...",
      checking: "Checking...",
    });
  });
});

describe("buildTaskResetImplementationConfirmCopy", () => {
  const input = (
    overrides: Partial<TaskResetImplementationCopyInput> = {},
  ): TaskResetImplementationCopyInput => ({
    taskId: "ODT-5",
    taskTitle: "Fix login",
    targetStatusLabel: "Ready for Dev",
    activeSessionCount: 0,
    activeSessionCountError: null,
    isLoadingImpact: false,
    hasCanonicalWorktree: false,
    hasManagedSessionCleanup: false,
    managedWorktreeCount: 0,
    legacyWorktreeCount: 0,
    terminalCount: 0,
    impactError: null,
    ...overrides,
  });

  test("names the task and the target status in the description", () => {
    const copy = buildTaskResetImplementationConfirmCopy(input());
    expect(copy.description).toBe(
      "Reset the current implementation for Fix login. Builder and QA progress for this task will be discarded and the task will move back to Ready for Dev.",
    );
    expect(
      copy.descriptionSegments.filter((segment) => segment.emphasis).map((segment) => segment.text),
    ).toEqual(["Fix login", "Ready for Dev"]);
  });

  test("states what the host keeps and removes for a canonical worktree", () => {
    const copy = buildTaskResetImplementationConfirmCopy(
      input({ hasCanonicalWorktree: true, legacyWorktreeCount: 2, terminalCount: 1 }),
    );
    expect(texts(copy)).toEqual([
      "This action removes Builder and QA session history for this task.",
      "The canonical task worktree and branch are retained. Tracked content is reset to the latest locally available base, ordinary untracked files are removed, and ignored files are preserved.",
      "2 legacy implementation worktrees and their related local branches will be deleted. Any uncommitted changes in those worktrees will be lost.",
      "Other related local task branches will be deleted if present.",
      "1 associated terminal will be terminated before the implementation resets.",
      "QA report artifacts and linked pull request metadata will be cleared. Specification, Implementation Plan, and free artifacts are kept.",
      "Specs and implementation plans are kept. The task status will move back to Ready for Dev.",
    ]);
    expect(copy.confirmLabel).toEqual({
      idle: "Reset implementation",
      pending: "Resetting implementation…",
      checking: "Checking impact…",
    });
  });

  test("names related branches without a canonical worktree", () => {
    const copy = buildTaskResetImplementationConfirmCopy(
      input({ legacyWorktreeCount: 1, activeSessionCount: 1 }),
    );
    expect(texts(copy).slice(1, 4)).toEqual([
      "1 active agent session will be stopped before the reset.",
      "1 legacy implementation worktree and its related local branch will be deleted. Any uncommitted changes in that worktree will be lost.",
      "Related local task branches will be deleted if present.",
    ]);
  });
});

describe("taskResetImplementationConfirmState", () => {
  const copy = {
    confirmLabel: { idle: "Reset", pending: "Resetting...", checking: "Checking impact…" },
  };

  test("waits for the impact reads and the reset", () => {
    expect(
      taskResetImplementationConfirmState(
        { isSubmitting: false, isLoadingImpact: true, activeSessionCountError: null },
        copy,
      ),
    ).toEqual({ isBusy: true, disabled: true, label: "Checking impact…" });
    expect(
      taskResetImplementationConfirmState(
        { isSubmitting: true, isLoadingImpact: false, activeSessionCountError: null },
        copy,
      ),
    ).toEqual({ isBusy: true, disabled: true, label: "Resetting..." });
  });

  test("blocks the reset when the active session check failed", () => {
    expect(
      taskResetImplementationConfirmState(
        { isSubmitting: false, isLoadingImpact: false, activeSessionCountError: "Host error." },
        copy,
      ),
    ).toEqual({ isBusy: false, disabled: true, label: "Reset" });
  });
});
