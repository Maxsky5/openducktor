import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { render as renderUi } from "@testing-library/react";
import { act, createElement, createRef, type ReactElement } from "react";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import type { TaskCard } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { taskQueryKeys } from "@/state/queries/tasks";
import { collectDeleteImpactTaskIds, toSubtasks } from "./task-details-sheet-model";
import type { TaskDetailsSheetControllerHandle } from "./task-details-sheet-controller";

import { QueryProvider } from "@/lib/query-provider";
const render = (element: ReactElement) =>
  renderUi(element, {
    wrapper: ({ children }) => createElement(QueryProvider, { useIsolatedClient: true }, children),
  });
enableReactActEnvironment();

const actualTaskDetailsSheetModule = await import("./task-details-sheet");

type TaskDetailsSheetRenderProps = Parameters<
  typeof actualTaskDetailsSheetModule.TaskDetailsSheet
>[0];

type TaskDetailsSheetControllerComponent =
  typeof import("./task-details-sheet-controller").TaskDetailsSheetController;

const activeWorkspace = {
  workspaceId: "workspace-a",
  workspaceName: "Workspace A",
  repoPath: "/repo-a",
};

const taskDetailsSheetRenderMock = mock((_props: TaskDetailsSheetRenderProps) => null);
let taskDetailsSheetSpy: { mockRestore(): void };

async function importMockedTaskDetailsSheetController(): Promise<TaskDetailsSheetControllerComponent> {
  const { TaskDetailsSheetController } = await import("./task-details-sheet-controller");
  return TaskDetailsSheetController;
}

describe("TaskDetailsSheetController", () => {
  test("opens a closed task outside the board and clears selection on workspace switch", async () => {
    const TaskDetailsSheetController = await importMockedTaskDetailsSheetController();
    const child = createTaskCardFixture({
      id: "closed-child",
      status: "closed",
      parentId: "closed-task",
    });
    const task = createTaskCardFixture({
      id: "closed-task",
      status: "closed",
      issueType: "epic",
      subtaskIds: [child.id],
    });
    const client = new QueryClient();
    client.setQueryData(taskQueryKeys.repoData(activeWorkspace.repoPath), { tasks: [task, child] });
    client.setQueryData(taskQueryKeys.repoData("/repo-b"), { tasks: [task] });
    const ref = createRef<TaskDetailsSheetControllerHandle>();
    const controller = (repoPath: string) =>
      createElement(TaskDetailsSheetController, {
        ref,
        activeWorkspace: { ...activeWorkspace, repoPath },
        allTasks: [],
        taskSessionsByTaskId: new Map(),
        historicalSessionsByTaskId: new Map(),
        activeTaskSessionContextByTaskId: new Map(),
        workflowActionsEnabled: false,
      });
    const rendered = renderUi(controller(activeWorkspace.repoPath), {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
    });
    await act(async () => ref.current?.openTask(task.id));
    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ task, open: true, allTasks: [task, child] }),
    );
    const sheet = taskDetailsSheetRenderMock.mock.calls.at(-1)?.[0];
    if (!sheet) throw new Error("Expected task sheet props.");
    const taskById = new Map(sheet.allTasks.map((entry) => [entry.id, entry]));
    expect(toSubtasks(sheet.task, taskById)).toEqual([child]);
    expect(collectDeleteImpactTaskIds(sheet.task, taskById)).toEqual([task.id, child.id]);
    await act(async () => rendered.rerender(controller("/repo-b")));
    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ task: null, open: false }),
    );
    await act(async () => rendered.rerender(controller(activeWorkspace.repoPath)));
    expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ task: null, open: false }),
    );
    rendered.unmount();
    client.clear();
  });

  beforeEach(() => {
    taskDetailsSheetSpy = spyOn(
      actualTaskDetailsSheetModule,
      "TaskDetailsSheet",
    ).mockImplementation((props: TaskDetailsSheetRenderProps): ReactElement => {
      taskDetailsSheetRenderMock(props);
      return createElement("div");
    });
  });

  afterEach(() => {
    taskDetailsSheetSpy.mockRestore();
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
