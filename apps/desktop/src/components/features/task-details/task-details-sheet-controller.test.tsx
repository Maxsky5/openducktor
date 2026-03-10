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
        open: true,
        workflowActionsEnabled: false,
      }),
    );

    await act(async () => {
      renderer.unmount();
    });
  });
});
