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
        isLoadingImpact={false}
        hasManagedSessionCleanup
        managedWorktreeCount={2}
        impactError={null}
        isResetPending={false}
        resetError={null}
      />,
    );

    expect(screen.getByText("Reset Task")).toBeDefined();
    expect(screen.getByText(/moves the task back to Backlog/i)).toBeDefined();
    expect(screen.getByText(/spec, plan, and QA documents/i)).toBeDefined();
    expect(screen.getByText(/spec, planner, builder, and QA sessions/i)).toBeDefined();
    expect(screen.getByText(/pull request and direct-merge metadata/i)).toBeDefined();
    expect(screen.getByText(/2 linked task worktrees/i)).toBeDefined();
  });

  test("disables submit while cleanup impact is loading", () => {
    render(
      <TaskResetConfirmDialog
        open
        onOpenChange={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        taskId="TASK-123"
        isLoadingImpact
        hasManagedSessionCleanup={false}
        managedWorktreeCount={0}
        impactError={null}
        isResetPending={false}
        resetError={null}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Checking..." }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
