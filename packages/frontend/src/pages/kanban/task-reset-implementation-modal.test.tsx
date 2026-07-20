import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { KanbanPageModels } from "./kanban-page-model-types";
import { TaskResetImplementationModal } from "./task-reset-implementation-modal";

const makeModel = (
  legacyWorktreeCount: number,
): NonNullable<KanbanPageModels["resetImplementationModal"]> => ({
  open: true,
  taskId: "task-1",
  taskTitle: "Task One",
  targetStatusLabel: "Ready for Dev",
  isSubmitting: false,
  isLoadingImpact: false,
  hasCanonicalWorktree: true,
  hasManagedSessionCleanup: true,
  managedWorktreeCount: legacyWorktreeCount + 1,
  legacyWorktreeCount,
  terminalCount: 0,
  impactError: null,
  errorMessage: null,
  onOpenChange: () => {},
  onCancel: () => {},
  onConfirm: () => {},
});

describe("TaskResetImplementationModal", () => {
  test("warns when legacy implementation worktrees will be deleted", () => {
    render(<TaskResetImplementationModal model={makeModel(2)} />);

    expect(screen.getByText(/canonical task worktree and branch are retained/i)).toBeDefined();
    expect(screen.getByText(/2 legacy implementation worktrees/i)).toBeDefined();
    expect(screen.getByText(/uncommitted changes in those worktrees will be lost/i)).toBeDefined();
  });

  test("does not warn about legacy deletion when only the canonical worktree exists", () => {
    render(<TaskResetImplementationModal model={makeModel(0)} />);

    expect(screen.queryByText(/legacy implementation worktree/i)).toBeNull();
    expect(
      screen.getByText(/other related local task branches will be deleted if present/i),
    ).toBeDefined();
  });

  test("uses singular wording for one legacy worktree", () => {
    render(<TaskResetImplementationModal model={makeModel(1)} />);

    expect(
      screen.getByText(
        /1 legacy implementation worktree and its related local branch will be deleted/i,
      ),
    ).toBeDefined();
    expect(screen.getByText(/uncommitted changes in that worktree will be lost/i)).toBeDefined();
  });

  test("warns when task terminals will be terminated", () => {
    render(<TaskResetImplementationModal model={{ ...makeModel(0), terminalCount: 2 }} />);

    expect(screen.getByText(/2 associated terminals will be terminated/i)).toBeDefined();
  });

  test("does not claim retention when only legacy worktrees exist", () => {
    render(
      <TaskResetImplementationModal model={{ ...makeModel(1), hasCanonicalWorktree: false }} />,
    );

    expect(screen.queryByText(/canonical task worktree and branch are retained/i)).toBeNull();
    expect(screen.getByText(/1 legacy implementation worktree/i)).toBeDefined();
  });

  test("warns that related branches may be deleted when no worktree exists", () => {
    render(
      <TaskResetImplementationModal
        model={{ ...makeModel(0), hasCanonicalWorktree: false, hasManagedSessionCleanup: false }}
      />,
    );

    expect(
      screen.getByText(/related local task branches will be deleted if present/i),
    ).toBeDefined();
  });
});
