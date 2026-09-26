import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { render as renderUi, waitFor } from "@testing-library/react";
import { act, createElement, createRef, type ReactElement } from "react";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import type { TaskCard } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { taskQueryKeys } from "@/state/queries/tasks";
import { withMockedToast } from "@/test-utils/mock-toast";
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
  test("does not report a missing notification task after deleting an open task", async () => {
    const TaskDetailsSheetController = await importMockedTaskDetailsSheetController();
    const task = createTaskCardFixture({ id: "task-1" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = taskQueryKeys.repoData(activeWorkspace.repoPath);
    client.setQueryData(queryKey, { tasks: [task] });
    const ref = createRef<TaskDetailsSheetControllerHandle>();
    const controller = (allTasks: TaskCard[]) =>
      createElement(TaskDetailsSheetController, { ref, activeWorkspace, allTasks });
    const rendered = renderUi(controller([task]), {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
    });
    try {
      await act(async () => ref.current?.openTask(task.id));
      await withMockedToast(async ({ toastErrorMock }) => {
        await act(async () => {
          client.setQueryData(queryKey, { tasks: [] });
          rendered.rerender(controller([]));
        });
        expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ task: null, open: false }),
        );
        expect(toastErrorMock).not.toHaveBeenCalled();
        await act(async () => ref.current?.openTask(task.id));
        expect(toastErrorMock).toHaveBeenCalledWith("Notification task no longer exists", {
          id: "task-details-unavailable:/repo-a:task-1",
          description: "The task was removed from this workspace.",
        });
      });
    } finally {
      rendered.unmount();
      client.clear();
    }
  });

  test.each([false, true])(
    "handles a cached task refresh failure, visible on board=%s",
    async (visibleOnBoard) => {
      const TaskDetailsSheetController = await importMockedTaskDetailsSheetController();
      const task = createTaskCardFixture({ id: "task-1", status: "closed" });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const queryKey = taskQueryKeys.repoData(activeWorkspace.repoPath);
      client.setQueryData(queryKey, { tasks: [task] });
      const ref = createRef<TaskDetailsSheetControllerHandle>();
      const rendered = renderUi(
        createElement(TaskDetailsSheetController, {
          ref,
          activeWorkspace,
          allTasks: visibleOnBoard ? [task] : [],
        }),
        { wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children) },
      );
      try {
        await act(async () => ref.current?.openTask(task.id));
        await withMockedToast(async ({ toastErrorMock }) => {
          let failRead = (_error: Error): void => {};
          const read = new Promise<never>((_resolve, reject) => {
            failRead = reject;
          });
          let refresh: Promise<unknown> = Promise.resolve();
          await act(async () => {
            refresh = client
              .fetchQuery({ queryKey, queryFn: () => read, staleTime: 0 })
              .catch(() => {});
          });
          expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ task, open: true }),
          );
          await act(async () => {
            failRead(new Error("Task read failed"));
            await refresh;
          });
          await waitFor(() => {
            expect(taskDetailsSheetRenderMock).toHaveBeenLastCalledWith(
              expect.objectContaining({
                task: visibleOnBoard ? task : null,
                open: visibleOnBoard,
              }),
            );
          });
          expect(client.getQueryData<{ tasks: TaskCard[] }>(queryKey)).toEqual({ tasks: [task] });
          if (visibleOnBoard) {
            expect(toastErrorMock).not.toHaveBeenCalled();
          } else {
            expect(toastErrorMock).toHaveBeenCalledTimes(1);
            expect(toastErrorMock).toHaveBeenCalledWith("Could not load notification task", {
              id: "task-details-unavailable:/repo-a:task-1",
              description: "Reload and open the task again.",
            });
          }
        });
      } finally {
        rendered.unmount();
        client.clear();
      }
    },
  );
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
