import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import * as taskStopImpactModule from "@/state/queries/use-task-stop-impact";
import { withMockedToast } from "@/test-utils/mock-toast";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import {
  createTaskCardFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import type { TaskConfirmRequestAction } from "@/components/features/task-details/task-confirm-dialog-types";
import { TaskConfirmDialogHost, useTaskConfirmDialogHost } from "./task-confirm-dialog-host";

enableReactActEnvironment();

const task = createTaskCardFixture({ id: "odt-1", availableActions: ["reset_task"] });
const workspaceA = { workspaceId: "workspace-a", repoPath: "/repo-a" };
const workspaceB = { workspaceId: "workspace-b", repoPath: "/repo-b" };
const TITLES = { reset_task: "Reset Task", delete: "Delete Task" } as const;
const CONFIRM_LABELS = { reset_task: "Reset task", delete: "Delete" } as const;

type HostProps = Parameters<typeof useTaskConfirmDialogHost>[0];

const createHandlers = () => ({
  tasks: [task],
  onResetTask: mock(async (_taskId: string) => {}),
  onDelete: mock(async (_taskId: string, _options: { deleteSubtasks: boolean }) => {}),
  onSucceeded: mock((_taskId: string) => {}),
});

let confirmTaskAction: (taskId: string, action: TaskConfirmRequestAction) => void = () => {};

/** The host as `TaskWorkflowActionsProvider` mounts it, with a focusable element beside it. */
function Host(props: HostProps): ReactElement {
  const { onConfirmTaskAction, model } = useTaskConfirmDialogHost(props);
  confirmTaskAction = onConfirmTaskAction;
  return (
    <QueryProvider>
      <WorkspaceStateContext.Provider value={createWorkspaceStateFixture()}>
        <button type="button">Before the palette</button>
        <TaskConfirmDialogHost model={model} />
      </WorkspaceStateContext.Provider>
    </QueryProvider>
  );
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const request = async (action: TaskConfirmRequestAction): Promise<void> => {
  await act(async () => confirmTaskAction(task.id, action));
  await settle();
};

let view: ReturnType<typeof render> | null = null;

afterEach(() => {
  view?.unmount();
  view = null;
});

describe("TaskConfirmDialogHost", () => {
  test.each(["reset_task", "delete"] as const)(
    "opens only the %s confirmation of the request",
    async (action) => {
      view = render(<Host workspaceIdentity={workspaceA} {...createHandlers()} />);
      await request(action);

      expect(screen.getByRole("dialog", { name: TITLES[action] })).toBeTruthy();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    },
  );

  test("returns focus after a cancel and opens the same confirmation again", async () => {
    view = render(<Host workspaceIdentity={workspaceA} {...createHandlers()} />);
    const before = screen.getByRole("button", { name: "Before the palette" });
    before.focus();
    await request("delete");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(before);

    await request("delete");
    expect(screen.getByRole("dialog", { name: "Delete Task" })).toBeTruthy();
  });

  test.each([
    ["reset_task", "onResetTask", [task.id]],
    ["delete", "onDelete", [task.id, { deleteSubtasks: true }]],
  ] as const)(
    "runs the confirmed %s through %s, then reports the success",
    async (action, handlerName, expectedArgs) => {
      // The test has no host bridge, so the stop impact comes from a local fake.
      const stopImpactSpy = spyOn(taskStopImpactModule, "useTaskStopImpact").mockReturnValue({
        stoppableSessionCount: 0,
        isLoading: false,
        error: null,
      });
      try {
        const handlers = createHandlers();
        view = render(<Host workspaceIdentity={workspaceA} {...handlers} />);
        await request(action);

        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABELS[action] }));
        });
        await settle();

        expect(handlers[handlerName]).toHaveBeenCalledWith(...expectedArgs);
        expect(handlers.onSucceeded).toHaveBeenCalledWith(task.id);
        expect(screen.queryByRole("dialog")).toBeNull();
      } finally {
        stopImpactSpy.mockRestore();
      }
    },
  );

  test.each(["reset_task", "delete"] as const)(
    "drops the open %s confirmation when the active workspace changes",
    async (action) => {
      const handlersA = createHandlers();
      const handlersB = createHandlers();
      view = render(<Host workspaceIdentity={workspaceA} {...handlersA} />);
      await request(action);
      expect(screen.getByRole("dialog", { name: TITLES[action] })).toBeTruthy();

      // Workspace B also has a task with the same ID.
      view.rerender(<Host workspaceIdentity={workspaceB} {...handlersB} />);
      await settle();
      expect(screen.queryByRole("dialog")).toBeNull();

      view.rerender(<Host workspaceIdentity={workspaceA} {...handlersA} />);
      await settle();
      expect(screen.queryByRole("dialog")).toBeNull();
      for (const handlers of [handlersA, handlersB]) {
        expect(handlers.onResetTask).not.toHaveBeenCalled();
        expect(handlers.onDelete).not.toHaveBeenCalled();
      }
    },
  );

  test("replaces an open confirmation with a new request", async () => {
    view = render(<Host workspaceIdentity={workspaceA} {...createHandlers()} />);
    await request("delete");
    await request("reset_task");

    expect(screen.getByRole("dialog", { name: "Reset Task" })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  test("names the missing workspace instead of opening a confirmation", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      view = render(<Host workspaceIdentity={null} {...createHandlers()} />);
      await request("delete");

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(toastErrorMock).toHaveBeenCalledWith("Unable to open the confirmation", {
        description: `No workspace is active for task ${task.id}. Select its workspace and try again.`,
      });
    });
  });
});
