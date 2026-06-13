import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { render } from "@testing-library/react";
import { act, createElement, createRef, type ReactElement } from "react";
import type { KanbanTaskSession } from "@/components/features/kanban/kanban-task-activity";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { TaskDetailsSheetControllerHandle } from "./task-details-sheet-controller";

enableReactActEnvironment();

const actualTaskDetailsSheetModule = await import("./task-details-sheet");

type TaskDetailsSheetRenderProps = {
  activeWorkspace?: { workspaceId: string; workspaceName: string; repoPath: string } | null;
  task: TaskCard | null;
  allTasks: TaskCard[];
  taskSessions: KanbanTaskSession[];
  hasActiveSession: boolean;
  open: boolean;
  workflowActionsEnabled?: boolean;
  onOpenChange: (open: boolean) => void;
};

type TaskDetailsSheetControllerComponent =
  typeof import("./task-details-sheet-controller").TaskDetailsSheetController;

const activeWorkspace = {
  workspaceId: "workspace-a",
  workspaceName: "Workspace A",
  repoPath: "/repo-a",
};

const taskDetailsSheetRenderMock = mock((_props: TaskDetailsSheetRenderProps) => null);

async function restoreTaskDetailsSheetModule(): Promise<void> {
  await restoreMockedModules([["./task-details-sheet", async () => actualTaskDetailsSheetModule]]);
}

async function importMockedTaskDetailsSheetController(): Promise<TaskDetailsSheetControllerComponent> {
  const { TaskDetailsSheetController } = await import("./task-details-sheet-controller");
  await restoreTaskDetailsSheetModule();
  return TaskDetailsSheetController;
}

describe("TaskDetailsSheetController", () => {
  beforeEach(() => {
    mock.module("./task-details-sheet", () => ({
      TaskDetailsSheet: (props: TaskDetailsSheetRenderProps): ReactElement | null => {
        taskDetailsSheetRenderMock(props);
        return null;
      },
    }));
  });

  afterEach(async () => {
    await restoreTaskDetailsSheetModule();
  });

  beforeEach(() => {
    taskDetailsSheetRenderMock.mockClear();
  });

  test("opens the details sheet without rerendering the parent component", async () => {
    const TaskDetailsSheetController = await importMockedTaskDetailsSheetController();

    const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
    const controllerRef = createRef<TaskDetailsSheetControllerHandle>();
    let parentRenderCount = 0;

    const Parent = (): ReactElement | null => {
      parentRenderCount += 1;
      return createElement(TaskDetailsSheetController, {
        ref: controllerRef,
        activeWorkspace,
        allTasks: [task],
        taskSessionsByTaskId: new Map(),
        historicalSessionsByTaskId: new Map(),
        activeTaskSessionContextByTaskId: new Map(),
        workflowActionsEnabled: false,
      });
    };

    const rendered = render(createElement(Parent));

    expect(parentRenderCount).toBe(1);
    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task: null,
        activeWorkspace,
        allTasks: [task],
        open: false,
        workflowActionsEnabled: false,
      }),
    );

    await act(async () => {
      controllerRef.current?.openTask(task.id);
    });

    expect(parentRenderCount).toBe(1);
    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task,
        activeWorkspace,
        allTasks: [task],
        open: true,
        workflowActionsEnabled: false,
      }),
    );

    await act(async () => {
      rendered.unmount();
    });
  });

  test("forwards pull request detection props to the task details sheet", async () => {
    const TaskDetailsSheetController = await importMockedTaskDetailsSheetController();

    const task = createTaskCardFixture({ id: "task-1", title: "Task 1", status: "human_review" });
    const controllerRef = createRef<TaskDetailsSheetControllerHandle>();
    const onDetectPullRequest = mock((_taskId: string) => {});
    const onUnlinkPullRequest = mock((_taskId: string) => {});

    const rendered = render(
      createElement(TaskDetailsSheetController, {
        ref: controllerRef,
        activeWorkspace,
        allTasks: [task],
        taskSessionsByTaskId: new Map(),
        historicalSessionsByTaskId: new Map(),
        activeTaskSessionContextByTaskId: new Map(),
        workflowActionsEnabled: false,
        onDetectPullRequest,
        onUnlinkPullRequest,
        detectingPullRequestTaskId: "task-1",
        unlinkingPullRequestTaskId: "task-1",
      }),
    );

    await act(async () => {
      controllerRef.current?.openTask(task.id);
    });

    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task,
        activeWorkspace,
        open: true,
        onDetectPullRequest,
        onUnlinkPullRequest,
        detectingPullRequestTaskId: "task-1",
        unlinkingPullRequestTaskId: "task-1",
      }),
    );

    await act(async () => {
      rendered.unmount();
    });
  });

  test("closes the sheet when the selected task disappears from the task list", async () => {
    const TaskDetailsSheetController = await importMockedTaskDetailsSheetController();

    const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
    const controllerRef = createRef<TaskDetailsSheetControllerHandle>();

    const renderController = (allTasks: TaskCard[]) =>
      createElement(TaskDetailsSheetController, {
        ref: controllerRef,
        allTasks,
        taskSessionsByTaskId: new Map(),
        historicalSessionsByTaskId: new Map(),
        activeTaskSessionContextByTaskId: new Map(),
        workflowActionsEnabled: false,
      });

    const rendered = render(renderController([task]));

    await act(async () => {
      controllerRef.current?.openTask(task.id);
    });
    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task,
        open: true,
      }),
    );

    await act(async () => {
      rendered.rerender(renderController([]));
    });
    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task: null,
        open: false,
      }),
    );

    await act(async () => {
      rendered.unmount();
    });
  });
});
