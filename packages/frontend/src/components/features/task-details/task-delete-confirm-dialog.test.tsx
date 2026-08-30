import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import {
  formatActiveSessionStopMessage,
  formatManagedSessionCleanupLoadingMessage,
  formatManagedSessionCleanupMessage,
  formatUnknownManagedSessionCleanupMessage,
} from "./task-cleanup-impact-model";
import { TaskDeleteConfirmDialog } from "./task-delete-confirm-dialog";

const renderDialog = (
  terminalCount: number,
  activeSessionCount: number | null = 0,
  activeSessionCountError: string | null = null,
) =>
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
        activeSessionCount,
        activeSessionCountError,
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

  test("hides session-stop copy when no active sessions exist", () => {
    const rendered = renderDialog(0);

    expect(screen.queryByText(/active agent session/i)).toBeNull();

    rendered.unmount();
  });

  test("says how many active sessions will be stopped before deletion", () => {
    const rendered = renderDialog(0, 2);

    expect(
      screen.getByText("2 active agent sessions will be stopped before deletion."),
    ).toBeDefined();

    rendered.unmount();
  });

  test("shows the preview failure and keeps confirm disabled while it is unresolved", () => {
    const rendered = renderDialog(0, null, "host unavailable");

    expect(
      screen.getByText(
        /Unable to check how many active sessions will be stopped: host unavailable/,
      ),
    ).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Delete" }).disabled).toBe(true);

    rendered.unmount();
  });

  test("formats singular session-stop copy", () => {
    expect(formatActiveSessionStopMessage(1, "delete")).toBe(
      "1 active agent session will be stopped before deletion.",
    );
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
