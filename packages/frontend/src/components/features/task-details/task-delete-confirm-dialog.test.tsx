import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import {
  formatManagedSessionCleanupLoadingMessage,
  formatManagedSessionCleanupMessage,
  formatUnknownManagedSessionCleanupMessage,
} from "./task-cleanup-impact-model";
import { TaskDeleteConfirmDialog } from "./task-delete-confirm-dialog";

const renderDialog = (terminalCount: number) =>
  render(
    <TaskDeleteConfirmDialog
      open
      onOpenChange={() => {}}
      onCancel={() => {}}
      onConfirm={() => {}}
      taskId="task-1"
      subtasksCount={0}
      impact={{
        hasSubtasks: false,
        isLoading: false,
        hasManagedSessionCleanup: false,
        managedWorktreeCount: 0,
        terminalCount,
        error: null,
      }}
      deletion={{ isPending: false, error: null }}
    />,
  );

describe("TaskDeleteConfirmDialog", () => {
  test("uses standard spacing and hides terminal copy when no terminals will stop", () => {
    const rendered = renderDialog(0);

    expect(screen.queryByText(/running task terminals|associated terminal/i)).toBeNull();
    const body = screen.getByText("This action permanently removes the task.").parentElement
      ?.parentElement;
    expect(body?.className).toContain("py-4");
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton.parentElement?.className).toContain("justify-between");

    rendered.unmount();
  });

  test("warns when task terminals will be terminated", () => {
    const rendered = renderDialog(2);

    expect(screen.getByText(/2 associated terminals will be terminated/i)).toBeDefined();

    rendered.unmount();
  });

  test("mentions worktree and related branch cleanup when managed sessions exist", () => {
    const message = formatManagedSessionCleanupMessage(2);

    expect(message).toContain("2 linked task worktrees");
    expect(message).toContain("related local branches");
    expect(message).toContain("uncommitted changes");
  });

  test("uses exact-count wording when managed worktree count is known", () => {
    const message = formatManagedSessionCleanupMessage(1);

    expect(message).not.toContain("if they exist");
  });

  test("uses explicit unknown-impact wording when cleanup impact cannot be loaded", () => {
    const message = formatUnknownManagedSessionCleanupMessage();

    expect(message).toContain("may also be deleted");
    expect(message).toContain("related local branches");
    expect(message).toContain("uncommitted changes");
  });

  test("uses explicit loading wording while cleanup impact is still resolving", () => {
    const message = formatManagedSessionCleanupLoadingMessage("delete");

    expect(message).toContain("Checking linked task worktree cleanup impact");
    expect(message).toContain("before deletion");
  });

  test("uses operation-specific loading wording", () => {
    expect(formatManagedSessionCleanupLoadingMessage("close")).toContain("before closing");
    expect(formatManagedSessionCleanupLoadingMessage("reset")).toContain("before reset");
  });
});
