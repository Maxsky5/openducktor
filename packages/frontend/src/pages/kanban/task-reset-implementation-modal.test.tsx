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
  hasManagedSessionCleanup: true,
  managedWorktreeCount: legacyWorktreeCount + 1,
  legacyWorktreeCount,
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
});
