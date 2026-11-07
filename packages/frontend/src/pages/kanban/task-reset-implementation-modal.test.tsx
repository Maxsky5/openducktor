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
  test("warns when older worktrees will be deleted", () => {
    render(<TaskResetImplementationModal model={makeModel(2)} />);

    expect(screen.getByText(/Current worktree, its branch and ignored files/i)).toBeDefined();
    expect(screen.getByText(/2 older worktrees/i)).toBeDefined();
    expect(screen.getByText(/Uncommitted and untracked work will be lost/i)).toBeDefined();
  });

  test("does not warn about legacy deletion when only the canonical worktree exists", () => {
    render(<TaskResetImplementationModal model={makeModel(0)} />);

    expect(screen.queryByText(/older worktree/i)).toBeNull();
    expect(screen.getByText(/Remove other related local branches/i)).toBeDefined();
  });

  test("uses singular wording for one legacy worktree", () => {
    render(<TaskResetImplementationModal model={makeModel(1)} />);

    expect(screen.getByText(/Delete 1 older worktree and related local branches/i)).toBeDefined();
    expect(screen.getByText(/Uncommitted and untracked work will be lost/i)).toBeDefined();
  });

  test("warns when task terminals will be terminated", () => {
    render(<TaskResetImplementationModal model={{ ...makeModel(0), terminalCount: 2 }} />);

    expect(screen.getByText(/Close 2 terminals/i)).toBeDefined();
  });

  test("says how many active sessions will be stopped before the reset", () => {
    render(<TaskResetImplementationModal model={{ ...makeModel(0), activeSessionCount: 2 }} />);

    expect(screen.getByText("Stop 2 running agent sessions")).toBeDefined();
  });

  test("hides session-stop copy when no active sessions exist", () => {
    render(<TaskResetImplementationModal model={makeModel(0)} />);

    expect(screen.queryByText(/active agent session/i)).toBeNull();
  });

  test("hides session-stop copy while the host preview is unavailable", () => {
    render(<TaskResetImplementationModal model={{ ...makeModel(0), activeSessionCount: null }} />);

    expect(screen.queryByText(/active agent session/i)).toBeNull();
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
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Reset Implementation" }).disabled,
    ).toBe(true);
    expect(
      screen
        .getByRole<HTMLButtonElement>("button", { name: "Reset Implementation" })
        .getAttribute("aria-busy"),
    ).toBe("false");
    expect(document.body.innerHTML).not.toContain("lucide-loader-circle");
  });

  test("does not claim retention when only legacy worktrees exist", () => {
    render(
      <TaskResetImplementationModal model={{ ...makeModel(1), hasCanonicalWorktree: false }} />,
    );

    expect(screen.queryByText(/Current worktree, its branch and ignored files/i)).toBeNull();
    expect(screen.getByText(/1 older worktree/i)).toBeDefined();
  });

  test("warns that related branches may be deleted when no worktree exists", () => {
    render(
      <TaskResetImplementationModal
        model={{ ...makeModel(0), hasCanonicalWorktree: false, hasManagedSessionCleanup: false }}
      />,
    );

    expect(screen.getByText(/Remove related local branches/i)).toBeDefined();
  });
});
