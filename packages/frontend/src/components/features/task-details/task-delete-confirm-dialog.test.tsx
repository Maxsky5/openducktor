import { worktreeOwnersRead } from "@openducktor/frontend-core/test-support/worktree-owners-read";
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { TaskDeleteConfirmDialog } from "./task-delete-confirm-dialog";

const renderDialog = (
  terminalCount: number,
  activeSessionCount: number | null = 0,
  activeSessionCountError: string | null = null,
  isLoadingStopImpact = false,
) =>
  render(
    <TaskDeleteConfirmDialog
      open
      onOpenChange={() => {}}
      onCancel={() => {}}
      onConfirm={() => {}}
      task={{ id: "task-1", title: "Fix login" }}
      impact={{
        isLoading: false,
        isLoadingStopImpact,
        hasManagedSessionCleanup: false,
        managedWorktreeCount: 0,
        terminalCount,
        activeSessionCount,
        activeSessionCountError,
        worktreeOwners: worktreeOwnersRead(),
        error: null,
      }}
      operation={{ isPending: false, error: null, errorOutcomeUnknown: false }}
    />,
  );

describe("TaskDeleteConfirmDialog", () => {
  test("names the task by its title and its ID", () => {
    renderDialog(0);

    expect(screen.getByRole("heading", { name: "Delete task" })).toBeDefined();
    expect(screen.getByText("Fix login")).toBeDefined();
    expect(screen.getByText("task-1")).toBeDefined();
    expect(screen.getByText("This cannot be undone.")).toBeDefined();
  });

  test("uses standard spacing and hides terminal copy when no terminals will stop", () => {
    const rendered = renderDialog(0);

    expect(screen.queryByText(/running task terminals|associated terminal/i)).toBeNull();
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton.parentElement?.className).toContain("justify-between");

    rendered.unmount();
  });

  test("warns when task terminals will be terminated", () => {
    const rendered = renderDialog(2);

    expect(screen.getByText(/Close 2 terminals/i)).toBeDefined();

    rendered.unmount();
  });

  test("hides session-stop copy when no active sessions exist", () => {
    const rendered = renderDialog(0);

    expect(screen.queryByText(/active agent session/i)).toBeNull();

    rendered.unmount();
  });

  test("says how many active sessions will be stopped before deletion", () => {
    const rendered = renderDialog(0, 2);

    expect(screen.getByText("Stop 2 running agent sessions")).toBeDefined();

    rendered.unmount();
  });

  test("shows the preview failure and keeps confirm disabled while it is unresolved", () => {
    const rendered = renderDialog(0, null, "host unavailable");

    expect(screen.getByText(/Could not check running sessions: host unavailable/)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Delete task" }).disabled).toBe(
      true,
    );

    rendered.unmount();
  });

  test("hides incomplete copy and actions while the host stop preview is loading", () => {
    const rendered = renderDialog(0, null, null, true);

    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByText(/Checking linked task worktree cleanup impact/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Checking…" })).toBeNull();

    rendered.unmount();
  });
});
