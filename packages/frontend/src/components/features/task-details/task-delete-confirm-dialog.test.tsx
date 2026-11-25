import { worktreeOwnersRead } from "@openducktor/frontend-core/test-support/worktree-owners-read";
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { TaskDeleteConfirmDialog } from "./task-delete-confirm-dialog";

const renderDialog = (
  terminalCount: number,
  activeSessionCount: number | null,
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
  test("names the task and lists what deletion will stop", () => {
    renderDialog(2, 2);

    expect(screen.getByRole("dialog", { name: "Delete task" })).toBeDefined();
    expect(screen.getByText("Fix login")).toBeDefined();
    expect(screen.getByText("task-1")).toBeDefined();
    expect(screen.getByText("This cannot be undone.")).toBeDefined();
    expect(screen.getByText("Close 2 terminals")).toBeDefined();
    expect(screen.getByText("Stop 2 running agent sessions")).toBeDefined();
  });

  test("shows the preview failure and keeps confirm disabled while it is unresolved", () => {
    renderDialog(0, null, "host unavailable");

    expect(screen.getByText(/Could not check running sessions: host unavailable/)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Delete task" }).disabled).toBe(
      true,
    );
  });

  test("hides incomplete copy and actions while the host stop preview is loading", () => {
    renderDialog(0, null, null, true);

    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByText(/Checking linked task worktree cleanup impact/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete task" })).toBeNull();
  });
});
