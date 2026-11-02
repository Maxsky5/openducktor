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
        task={{ id: "TASK-123", title: "Fix login" }}
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
        operation={{ isPending: false, error: null, errorOutcomeUnknown: false }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Reset task" })).toBeDefined();
    expect(screen.getByText(/Move this task to Backlog/i)).toBeDefined();
    expect(screen.getByText(/all task artifacts/i)).toBeDefined();
    expect(screen.getByText(/Spec, Planner, Builder and QA sessions/i)).toBeDefined();
    expect(screen.getByText(/pull request and merge links/i)).toBeDefined();
    expect(screen.getByText(/2 linked worktrees/i)).toBeDefined();
    expect(screen.getByText(/Close 2 terminals/i)).toBeDefined();
    expect(screen.getByText("Stop 1 running agent session")).toBeDefined();
  });

  test("hides submit while cleanup impact is loading", () => {
    render(
      <TaskResetConfirmDialog
        open
        onOpenChange={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        task={{ id: "TASK-123", title: "Fix login" }}
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
        operation={{ isPending: false, error: null, errorOutcomeUnknown: false }}
      />,
    );

    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Checking…" })).toBeNull();
  });

  test("shows the preview failure and keeps confirm disabled while it is unresolved", () => {
    render(
      <TaskResetConfirmDialog
        open
        onOpenChange={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        task={{ id: "TASK-123", title: "Fix login" }}
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
        operation={{ isPending: false, error: null, errorOutcomeUnknown: false }}
      />,
    );

    expect(screen.getByText(/Could not check running sessions: host unavailable/)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Reset task" }).disabled).toBe(
      true,
    );
  });
});
