import { worktreeOwnersRead } from "@openducktor/frontend-core/test-support/worktree-owners-read";
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { TaskResetImplementationModalModel } from "@openducktor/frontend-core/tasks/workflow/use-task-reset-flow";
import { TaskResetImplementationModal } from "./task-reset-implementation-modal";

const makeModel = (legacyWorktreeCount: number): TaskResetImplementationModalModel => ({
  open: true,
  taskId: "task-1",
  taskTitle: "Task One",
  actionLabel: "Reset Implementation",
  targetStatusLabel: "Ready for Dev",
  worktreeRoleLabels: ["Builder", "QA"],
  dropsLocalMerge: false,
  isSubmitting: false,
  activeSessionCount: 0,
  activeSessionCountError: null,
  worktreeOwners: worktreeOwnersRead(),
  isLoadingImpact: false,
  hasCanonicalWorktree: true,
  hasManagedSessionCleanup: true,
  managedWorktreeCount: legacyWorktreeCount + 1,
  legacyWorktreeCount,
  terminalCount: 0,
  impactError: null,
  errorMessage: null,
  errorOutcomeUnknown: false,
  onOpenChange: () => {},
  onCancel: () => {},
  onConfirm: () => {},
});

describe("TaskResetImplementationModal", () => {
  test("distinguishes the worktree to keep from work that will stop or be lost", () => {
    render(
      <TaskResetImplementationModal
        model={{ ...makeModel(2), terminalCount: 2, activeSessionCount: 2 }}
      />,
    );

    expect(screen.getByText(/Current worktree, its branch and ignored files/i)).toBeDefined();
    expect(screen.getByText(/2 older worktrees/i)).toBeDefined();
    expect(screen.getByText(/Uncommitted and untracked work will be lost/i)).toBeDefined();
    expect(screen.getByText("Close 2 terminals")).toBeDefined();
    expect(screen.getByText("Stop 2 running agent sessions")).toBeDefined();
  });

  test("shows the preview failure and keeps confirm disabled while it is unresolved", () => {
    render(
      <TaskResetImplementationModal
        model={{
          ...makeModel(0),
          activeSessionCount: null,
          activeSessionCountError: "host unavailable",
        }}
      />,
    );

    expect(screen.getByText(/Could not check running sessions: host unavailable/)).toBeDefined();
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: "Reset Implementation" });
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute("aria-busy")).toBe("false");
    expect(screen.queryByText(/Stop \d+ running agent session/)).toBeNull();
  });
});
