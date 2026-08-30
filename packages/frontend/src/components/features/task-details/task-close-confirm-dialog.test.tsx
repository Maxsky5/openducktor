import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { TaskCloseConfirmDialog } from "./task-close-confirm-dialog";

enableReactActEnvironment();

describe("TaskCloseConfirmDialog", () => {
  test("explains manual close effects and disables confirm while checking impact", () => {
    const { unmount } = render(
      <TaskCloseConfirmDialog
        open
        onOpenChange={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        taskId="TASK-1"
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
        closing={{ isPending: false, error: null }}
      />,
    );

    expect(screen.getByText(/moves the task to Done/i)).toBeDefined();
    expect(screen.getByText(/bypasses unfinished workflow steps/i)).toBeDefined();
    expect(screen.getByText(/No code is merged/i)).toBeDefined();
    expect(screen.getByText(/pull request is created, updated, or merged/i)).toBeDefined();
    expect(screen.getByText(/Task-scoped dev servers will be stopped/i)).toBeDefined();
    expect(
      screen.getByText(/task record, documents, QA reports, and linked history/i),
    ).toBeDefined();
    expect(document.body.innerHTML).toContain("border-warning-border");
    expect(document.body.innerHTML).toContain("bg-warning-surface");
    expect(document.body.innerHTML).not.toContain("border-destructive-border");
    expect(document.body.innerHTML).not.toContain("bg-destructive-surface");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Checking/i }).disabled).toBe(
      true,
    );

    unmount();
  });

  test("shows impact and host errors while keeping confirm available after impact failure", () => {
    const { unmount } = render(
      <TaskCloseConfirmDialog
        open
        onOpenChange={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        taskId="TASK-2"
        impact={{
          isLoading: false,
          isLoadingStopImpact: false,
          hasManagedSessionCleanup: false,
          managedWorktreeCount: 0,
          terminalCount: 2,
          activeSessionCount: 3,
          activeSessionCountError: null,
          error: "Could not preview cleanup",
        }}
        closing={{ isPending: false, error: "Close failed" }}
      />,
    );

    expect(screen.getByText("Could not preview cleanup")).toBeDefined();
    expect(screen.getByText("Close failed")).toBeDefined();
    expect(
      screen.getByText("3 active agent sessions will be stopped before closing."),
    ).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Close task/i }).disabled).toBe(
      false,
    );
    expect(document.body.innerHTML).toContain("lucide-circle-check-big");

    unmount();
  });

  test("shows the preview failure and keeps confirm disabled while it is unresolved", () => {
    const { unmount } = render(
      <TaskCloseConfirmDialog
        open
        onOpenChange={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        taskId="TASK-3"
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
        closing={{ isPending: false, error: null }}
      />,
    );

    expect(
      screen.getByText(
        /Unable to check how many active sessions will be stopped: host unavailable/,
      ),
    ).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Close task/i }).disabled).toBe(
      true,
    );

    unmount();
  });
});
