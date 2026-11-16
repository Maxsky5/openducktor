import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import {
  CLOSE_TASK_ACTION,
  type CoreTaskAction,
} from "@openducktor/frontend-core/tasks/workflow/core-task-actions";
import { Sheet } from "@/components/ui/sheet";
import { TaskDetailsSheetFooter } from "./task-details-sheet-footer";

enableReactActEnvironment();

const wrapper = ({ children }: { children: ReactNode }) => <Sheet open>{children}</Sheet>;

describe("TaskDetailsSheetFooter", () => {
  test("omits workflow actions when no workflow actions are available", () => {
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({ status: "closed", availableActions: [] })}
        onOpenChange={() => {}}
        includeActions={["human_approve", "human_request_changes", "open_builder", "build_start"]}
        onWorkflowAction={() => {}}
      />,
      { wrapper },
    );

    expect(screen.queryByText("More")).toBeNull();
    expect(screen.queryByText("No available workflow action")).toBeNull();

    unmount();
  });

  test("keeps footer action menu when delete is available without workflow actions", () => {
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({ status: "closed", availableActions: [] })}
        onOpenChange={() => {}}
        includeActions={["human_approve", "human_request_changes", "open_builder", "build_start"]}
        onWorkflowAction={() => {}}
        onDeleteSelect={() => {}}
      />,
      { wrapper },
    );

    expect(screen.getByText("More")).toBeDefined();

    unmount();
  });

  test("renders active-session view action when active and historical context is provided", () => {
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({
          status: "in_progress",
          availableActions: ["open_builder", "build_start"],
        })}
        onOpenChange={() => {}}
        includeActions={["open_builder", "open_spec", "open_planner", "build_start"]}
        hasActiveSession
        activeSessionRole="build"
        historicalSessionRoles={["spec", "planner"]}
        onWorkflowAction={() => {}}
      />,
      { wrapper },
    );

    expect(screen.getByText("Open Builder")).toBeDefined();
    expect(screen.getByText("More")).toBeDefined();
    expect(screen.queryByText("Start Builder")).toBeNull();

    unmount();
  });

  test("renders the core Reset Task and Close Task between the workflow actions and Delete task", () => {
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({
          status: "in_progress",
          availableActions: ["open_builder", "reset_implementation"],
        })}
        onOpenChange={() => {}}
        includeActions={["open_builder", "reset_implementation"]}
        onWorkflowAction={() => {}}
        onCoreTaskAction={() => {}}
        onDeleteSelect={() => {}}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByText("More"));
    const menu = screen.getByRole("dialog");
    const buttons = within(menu)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());

    expect(buttons).toEqual(["Reset Implementation", "Reset Task", "Close Task", "Delete Task"]);

    unmount();
  });

  test("runs the core Close Task, which the workflow does not declare", () => {
    const onWorkflowAction = mock(() => {});
    const onCoreTaskAction = mock((_action: CoreTaskAction) => {});
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({ status: "in_progress", availableActions: ["open_builder"] })}
        onOpenChange={() => {}}
        includeActions={["open_builder"]}
        onWorkflowAction={onWorkflowAction}
        onCoreTaskAction={onCoreTaskAction}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByText("More"));
    fireEvent.click(screen.getByText("Close Task"));

    expect(onCoreTaskAction).toHaveBeenCalledWith(CLOSE_TASK_ACTION);
    expect(onWorkflowAction).not.toHaveBeenCalled();

    unmount();
  });

  test("shows no session view action for a closed task with past sessions", () => {
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({ status: "closed", availableActions: [] })}
        onOpenChange={() => {}}
        includeActions={["open_builder", "open_qa"]}
        historicalSessionRoles={["build", "qa"]}
        onWorkflowAction={() => {}}
        onDeleteSelect={() => {}}
      />,
      { wrapper },
    );

    expect(screen.queryByText("Open Builder")).toBeNull();
    fireEvent.click(screen.getByText("More"));
    const buttons = within(screen.getByRole("dialog"))
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());
    expect(buttons).toEqual(["Delete Task"]);

    unmount();
  });

  test("shows no core action for a closed task", () => {
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({ status: "closed", availableActions: [] })}
        onOpenChange={() => {}}
        includeActions={[]}
        onWorkflowAction={() => {}}
        onCoreTaskAction={() => {}}
        onDeleteSelect={() => {}}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByText("More"));
    const buttons = within(screen.getByRole("dialog"))
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());

    expect(buttons).toEqual(["Delete Task"]);

    unmount();
  });

  test("shows the core Remove Worktree of a closed task before Delete Task", () => {
    const onRemoveWorktreeSelect = mock(() => {});
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({ status: "closed", availableActions: [] })}
        onOpenChange={() => {}}
        includeActions={[]}
        onWorkflowAction={() => {}}
        onCoreTaskAction={() => {}}
        onRemoveWorktreeSelect={onRemoveWorktreeSelect}
        onDeleteSelect={() => {}}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByText("More"));
    const buttons = within(screen.getByRole("dialog"))
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());
    expect(buttons).toEqual(["Remove Worktree", "Delete Task"]);

    fireEvent.click(screen.getByText("Remove Worktree"));
    expect(onRemoveWorktreeSelect).toHaveBeenCalledTimes(1);

    unmount();
  });
});
