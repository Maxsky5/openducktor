import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { render } from "@testing-library/react";
import { act, createElement, createRef, type ReactElement } from "react";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import type { TaskDetailsSheetControllerHandle } from "./task-details-sheet-controller";

enableReactActEnvironment();

const taskDetailsSheetRenderMock = mock(
  (_props: {
    task: TaskCard | null;
    allTasks: TaskCard[];
    runs: unknown[];
    open: boolean;
    workflowActionsEnabled?: boolean;
    onOpenChange: (open: boolean) => void;
  }) => null,
);

mock.module("./task-details-sheet", () => ({
  TaskDetailsSheet: (
    props: Parameters<typeof taskDetailsSheetRenderMock>[0],
  ): ReactElement | null => {
    taskDetailsSheetRenderMock(props);
    return null;
  },
}));

describe("TaskDetailsSheetController", () => {
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
        allTasks: [task],
        runs: [],
        workflowActionsEnabled: false,
      });
    };

    const rendered = render(createElement(Parent));

    expect(parentRenderCount).toBe(1);
    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task: null,
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
        allTasks: [task],
        runs: [],
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
