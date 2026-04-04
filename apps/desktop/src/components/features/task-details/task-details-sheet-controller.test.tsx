import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { render } from "@testing-library/react";
import { act, createElement, createRef, type ReactElement } from "react";
import type { KanbanTaskSession } from "@/components/features/kanban/kanban-task-activity";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import type { TaskDetailsSheetControllerHandle } from "./task-details-sheet-controller";

enableReactActEnvironment();

const taskDetailsSheetRenderMock = mock(
  (_props: {
    activeRepo?: string | null;
    task: TaskCard | null;
    allTasks: TaskCard[];
    runs: unknown[];
    taskSessions: KanbanTaskSession[];
    hasActiveSession: boolean;
    open: boolean;
    workflowActionsEnabled?: boolean;
    onOpenChange: (open: boolean) => void;
  }) => null,
);

describe("TaskDetailsSheetController", () => {
  beforeAll(() => {
    mock.module("./task-details-sheet", () => ({
      TaskDetailsSheet: (
        props: Parameters<typeof taskDetailsSheetRenderMock>[0],
      ): ReactElement | null => {
        taskDetailsSheetRenderMock(props);
        return null;
      },
    }));
  });

  beforeEach(() => {
    taskDetailsSheetRenderMock.mockClear();
  });

  test("opens the details sheet without rerendering the parent component", async () => {
    const { TaskDetailsSheetController } = await import("./task-details-sheet-controller");

    const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
    const controllerRef = createRef<TaskDetailsSheetControllerHandle>();
    let parentRenderCount = 0;

    const Parent = (): ReactElement | null => {
      parentRenderCount += 1;
      return createElement(TaskDetailsSheetController, {
        ref: controllerRef,
        activeRepo: "/repo-a",
        allTasks: [task],
        runs: [],
        taskSessionsByTaskId: new Map(),
        activeTaskSessionContextByTaskId: new Map(),
        onOpenSession: () => {},
        workflowActionsEnabled: false,
      });
    };

    const rendered = render(createElement(Parent));

    expect(parentRenderCount).toBe(1);
    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task: null,
        activeRepo: "/repo-a",
        allTasks: [task],
        runs: [],
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
        activeRepo: "/repo-a",
        allTasks: [task],
        runs: [],
        open: true,
        workflowActionsEnabled: false,
      }),
    );

    await act(async () => {
      rendered.unmount();
    });
  });

  test("forwards pull request detection props to the task details sheet", async () => {
    const { TaskDetailsSheetController } = await import("./task-details-sheet-controller");

    const task = createTaskCardFixture({ id: "task-1", title: "Task 1", status: "human_review" });
    const controllerRef = createRef<TaskDetailsSheetControllerHandle>();
    const onDetectPullRequest = mock((_taskId: string) => {});
    const onUnlinkPullRequest = mock((_taskId: string) => {});

    const rendered = render(
      createElement(TaskDetailsSheetController, {
        ref: controllerRef,
        activeRepo: "/repo-a",
        allTasks: [task],
        runs: [],
        taskSessionsByTaskId: new Map(),
        activeTaskSessionContextByTaskId: new Map(),
        onOpenSession: () => {},
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
        activeRepo: "/repo-a",
        open: true,
        runs: [],
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
});
