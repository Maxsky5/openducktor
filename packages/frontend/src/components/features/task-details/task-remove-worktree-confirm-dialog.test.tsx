import { worktreeOwnersRead } from "@openducktor/frontend-core/test-support/worktree-owners-read";
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { TaskRemoveWorktreeConfirmDialog } from "./task-remove-worktree-confirm-dialog";
import type { TaskWorktreeImpact } from "@openducktor/frontend-core/tasks/details/use-task-close-impact";

enableReactActEnvironment();

const BRANCH_WARNING = "Commits that exist only on this branch may be lost.";

const renderDialog = (impact: Partial<TaskWorktreeImpact>, isPreparing = false) =>
  render(
    <TaskRemoveWorktreeConfirmDialog
      open
      onOpenChange={() => {}}
      onCancel={() => {}}
      onConfirm={() => {}}
      operation={{ isPending: false, error: null, errorOutcomeUnknown: false }}
      taskId="TASK-1"
      impact={{
        worktreePaths: ["/worktrees/TASK-1"],
        branchNames: [],
        uncommittedFileCount: 0,
        terminalCount: 0,
        worktreeOwners: worktreeOwnersRead(),
        isLoading: false,
        isReady: true,
        error: null,
        retry: () => {},
        ...impact,
      }}
      isPreparing={isPreparing}
      confirmDisabled={false}
    />,
  );

describe("TaskRemoveWorktreeConfirmDialog", () => {
  test("shows one loader in place of the content until the reads end", () => {
    const view = renderDialog({ branchNames: ["odt/TASK-1"] }, true);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove worktree and branch" })).toBeNull();
    view.unmount();
  });

  test("warns that the branch deletion loses its own commits", () => {
    const view = renderDialog({ branchNames: ["odt/TASK-1"] });

    expect(screen.getByText(BRANCH_WARNING)).toBeTruthy();
    view.unmount();
  });

  test("shows no branch warning without a local branch", () => {
    const view = renderDialog({ branchNames: [] });

    expect(screen.queryByText(BRANCH_WARNING)).toBeNull();
    view.unmount();
  });

  test("focuses the dialog, not the copy control, so the Copy tooltip stays closed", () => {
    const view = renderDialog({ branchNames: ["odt/TASK-1"] });

    const dialog = screen.getByRole("dialog", { name: "Remove worktree" });
    expect(screen.getByRole("button", { name: "Copy task ID" })).toBeDefined();
    expect(document.activeElement).toBe(dialog);
    expect(screen.queryByRole("tooltip", { name: "Copy" })).toBeNull();
    view.unmount();
  });
});
