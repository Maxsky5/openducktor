import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { TaskResetConfirmDialog } from "./task-reset-confirm-dialog";

describe("TaskResetConfirmDialog", () => {
  test("explains the full destructive reset scope", () => {
    render(
      <TaskResetConfirmDialog
        open
        onOpenChange={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        taskId="TASK-123"
        impact={{
          isLoading: false,
          isLoadingStopImpact: false,
          hasManagedSessionCleanup: true,
          managedWorktreeCount: 2,
          terminalCount: 2,
          activeSessionCount: 1,
          activeSessionCountError: null,
          error: null,
        }}
        reset={{ isPending: false, error: null }}
      />,
    );

    expect(screen.getByText("Reset Task")).toBeDefined();
    expect(screen.getByText(/moves the task back to Backlog/i)).toBeDefined();
    expect(screen.getByText(/spec, plan, and QA documents/i)).toBeDefined();
    expect(screen.getByText(/spec, planner, builder, and QA sessions/i)).toBeDefined();
    expect(screen.getByText(/pull request and direct-merge metadata/i)).toBeDefined();
    expect(screen.getByText(/2 linked task worktrees/i)).toBeDefined();
    expect(screen.getByText(/2 associated terminals will be terminated/i)).toBeDefined();
    expect(
      screen.getByText("1 active agent session will be stopped before the reset."),
    ).toBeDefined();
  });

  test("disables submit while cleanup impact is loading", () => {
    render(
      <TaskResetConfirmDialog
        open
        onOpenChange={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        taskId="TASK-123"
        impact={{
          isLoading: true,
          isLoadingStopImpact: false,
          hasManagedSessionCleanup: false,
          managedWorktreeCount: 0,
          terminalCount: 0,
          activeSessionCount: 0,
          activeSessionCountError: null,
          error: null,
        }}
        reset={{ isPending: false, error: null }}
      />,
    );

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Checking..." }).disabled).toBe(
      true,
    );
  });

  test("shows the preview failure and keeps confirm disabled while it is unresolved", () => {
    render(
      <TaskResetConfirmDialog
        open
        onOpenChange={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        taskId="TASK-123"
        impact={{
          isLoading: false,
          isLoadingStopImpact: false,
          hasManagedSessionCleanup: false,
          managedWorktreeCount: 0,
          terminalCount: 0,
          activeSessionCount: null,
          activeSessionCountError: "host unavailable",
          error: null,
        }}
        reset={{ isPending: false, error: null }}
      />,
    );

    expect(
      screen.getByText(
        /Unable to check how many active sessions will be stopped: host unavailable/,
      ),
    ).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Reset task" }).disabled).toBe(
      true,
    );
  });
});
