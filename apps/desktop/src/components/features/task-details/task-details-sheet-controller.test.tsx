import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { createElement, createRef, type ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
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

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Parent));
    });

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
      renderer.unmount();
    });
  });

  test("forwards pull request detection props to the task details sheet", async () => {
    const { TaskDetailsSheetController } = await import("./task-details-sheet-controller");

    const task = createTaskCardFixture({ id: "task-1", title: "Task 1", status: "human_review" });
    const controllerRef = createRef<TaskDetailsSheetControllerHandle>();
    const onDetectPullRequest = mock((_taskId: string) => {});
    const onUnlinkPullRequest = mock((_taskId: string) => {});

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
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
    });

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
      renderer.unmount();
    });
  });

  test("syncs controlled active task ids and close events", async () => {
    const { TaskDetailsSheetController } = await import("./task-details-sheet-controller");

    const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
    const onActiveTaskIdChange = mock((_taskId: string | null) => {});

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(TaskDetailsSheetController, {
          allTasks: [task],
          runs: [],
          workflowActionsEnabled: false,
          activeTaskId: null,
          onActiveTaskIdChange,
        }),
      );
    });

    await act(async () => {
      renderer.update(
        createElement(TaskDetailsSheetController, {
          allTasks: [task],
          runs: [],
          workflowActionsEnabled: false,
          activeTaskId: task.id,
          onActiveTaskIdChange,
        }),
      );
    });

    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task,
        open: true,
      }),
    );

    const latestProps = taskDetailsSheetRenderMock.mock.calls.at(-1)?.[0] as
      | { onOpenChange: (open: boolean) => void }
      | undefined;
    expect(latestProps).toBeTruthy();

    await act(async () => {
      latestProps?.onOpenChange(false);
    });

    expect(onActiveTaskIdChange).toHaveBeenLastCalledWith(null);

    await act(async () => {
      renderer.update(
        createElement(TaskDetailsSheetController, {
          allTasks: [task],
          runs: [],
          workflowActionsEnabled: false,
          activeTaskId: null,
          onActiveTaskIdChange,
        }),
      );
    });

    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task: null,
        open: false,
      }),
    );

    await act(async () => {
      renderer.unmount();
    });
  });
});
