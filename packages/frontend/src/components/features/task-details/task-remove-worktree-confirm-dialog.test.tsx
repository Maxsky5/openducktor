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

    expect(screen.getByText("Loading the task")).toBeTruthy();
    expect(screen.queryByText("/worktrees/TASK-1")).toBeNull();
    expect(screen.queryByText(BRANCH_WARNING)).toBeNull();
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
});
