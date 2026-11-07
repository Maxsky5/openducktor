import { worktreeOwnersRead } from "../../test-support/worktree-owners-read";
import { describe, expect, test } from "bun:test";
import {
  buildTaskDeleteConfirmCopy,
  buildTaskResetConfirmCopy,
  buildTaskResetImplementationConfirmCopy,
  type TaskResetImplementationCopyInput,
  taskResetImplementationConfirmState,
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
  worktreeOwners: worktreeOwnersRead(),
  error: null,
  ...overrides,
});

test("reset separates the kept task from removed work and names worktree loss", () => {
  const copy = buildTaskResetConfirmCopy(
    { id: "ODT-2", title: "Fix login" },
    impact({
      terminalCount: 2,
      activeSessionCount: 1,
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 1,
    }),
  );
  expect(copy.subject).toEqual({ id: "ODT-2", title: "Fix login" });
  expect(copy.description).toBe("Move this task back to the start of its workflow.");
  expect(copy.changes).toContain("Remove all task sessions");
  expect(copy.changes).toContain("Delete 1 linked worktree and related local branches");
  expect(copy.changes).toContain("Stop 1 running agent session");
  expect(copy.changes).toContain("Close 2 terminals");
  expect(copy.kept).toEqual(["Task title, description and labels"]);
  expect(copy.warning).toContain("Uncommitted work");
  expect(copy.confirmLabel.idle).toBe("Reset task");
});

test("delete does not invent worktree loss when the read found no worktree", () => {
  const copy = buildTaskDeleteConfirmCopy({ id: "ODT-3", title: null }, impact());
  expect(copy.subject.id).toBe("ODT-3");
  expect(copy.kept).toEqual([]);
  expect(copy.changes.some((change) => change.includes("worktree"))).toBe(false);
  expect(copy.warning).toBe("This cannot be undone.");
});

test("failed impact reads keep their errors and do not claim that cleanup is known", () => {
  const copy = buildTaskDeleteConfirmCopy(
    { id: "ODT-4", title: null },
    impact({ activeSessionCountError: "host unavailable", error: "Could not read worktree." }),
  );
  expect(copy.errors).toEqual([
    "Could not check running sessions: host unavailable",
    "Could not read worktree.",
  ]);
  expect(copy.changes).toContain("Remove linked worktrees and local branches, if present");
  expect(copy.warning).toContain("Uncommitted work");
});

const implementation = (
  overrides: Partial<TaskResetImplementationCopyInput> = {},
): TaskResetImplementationCopyInput => ({
  taskId: "ODT-5",
  taskTitle: "Fix login",
  actionLabel: "Reset Implementation",
  targetStatusLabel: "Ready for Dev",
  worktreeRoleLabels: ["Builder", "QA"],
  dropsLocalMerge: false,
  activeSessionCount: 0,
  activeSessionCountError: null,
  hasCanonicalWorktree: false,
  legacyWorktreeCount: 0,
  terminalCount: 0,
  impactError: null,
  worktreeOwners: worktreeOwnersRead(),
  ...overrides,
});

test("implementation reset names its target and preserves the current checkout and ignored files", () => {
  const copy = buildTaskResetImplementationConfirmCopy(
    implementation({ hasCanonicalWorktree: true, legacyWorktreeCount: 2 }),
  );
  expect(copy.description).toContain("Ready for Dev");
  expect(copy.kept).toContain("Current worktree, its branch and ignored files");
  expect(copy.kept).toContain("Other task artifacts");
  expect(copy.changes).toContain("Delete 2 older worktrees and related local branches");
  expect(copy.changes).toContain(
    "Reset tracked files to the latest local base commit and delete untracked files",
  );
  expect(copy.warning).toContain("Uncommitted and untracked work");
});

test("implementation reset does not claim a checkout stays when none exists", () => {
  const copy = buildTaskResetImplementationConfirmCopy(implementation());
  expect(copy.kept).toEqual(["Other task artifacts"]);
  expect(copy.changes).toContain("Remove related local branches");
  expect(copy.warning).not.toContain("untracked");
});

test("implementation reset uses the workflow's action and role names and names a dropped local merge", () => {
  const copy = buildTaskResetImplementationConfirmCopy(
    implementation({
      actionLabel: "Restart Build",
      worktreeRoleLabels: ["Coder", "Reviewer"],
      dropsLocalMerge: true,
    }),
  );
  expect(copy.title).toBe("Restart Build");
  expect(copy.confirmLabel.idle).toBe("Restart Build");
  expect(copy.changes).toContain("Remove the Coder and Reviewer session history");
  expect(copy.changes).toContain(
    "Drop the record of the unpublished local merge. The merge commit stays on the local target branch",
  );
  expect(copy.warning).toContain("The Coder and Reviewer session history cannot be recovered.");
});

test("implementation reset lists one or three worktree roles in plain English", () => {
  const one = buildTaskResetImplementationConfirmCopy(
    implementation({ worktreeRoleLabels: ["Builder"] }),
  );
  const three = buildTaskResetImplementationConfirmCopy(
    implementation({ worktreeRoleLabels: ["Builder", "QA", "Fixer"] }),
  );
  expect(one.changes).toContain("Remove the Builder session history");
  expect(three.changes).toContain("Remove the Builder, QA, and Fixer session history");
});

describe("taskResetImplementationConfirmState", () => {
  const copy = {
    confirmLabel: { idle: "Reset", pending: "Resetting...", checking: "Checking impact…" },
  };

  test("waits for the impact reads and the reset", () => {
    expect(
      taskResetImplementationConfirmState(
        {
          isSubmitting: false,
          isLoadingImpact: true,
          activeSessionCountError: null,
          worktreeOwners: worktreeOwnersRead(),
        },
        copy,
      ),
    ).toEqual({ isBusy: true, disabled: true, label: "Checking impact…" });
    expect(
      taskResetImplementationConfirmState(
        {
          isSubmitting: true,
          isLoadingImpact: false,
          activeSessionCountError: null,
          worktreeOwners: worktreeOwnersRead(),
        },
        copy,
      ),
    ).toEqual({ isBusy: true, disabled: true, label: "Resetting..." });
  });

  test("blocks the reset when the active session check failed", () => {
    expect(
      taskResetImplementationConfirmState(
        {
          isSubmitting: false,
          isLoadingImpact: false,
          activeSessionCountError: "Host error.",
          worktreeOwners: worktreeOwnersRead(),
        },
        copy,
      ),
    ).toEqual({ isBusy: false, disabled: true, label: "Reset" });
  });
});
