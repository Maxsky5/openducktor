import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { TaskMergeStatus } from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import { ActiveWorkspaceContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import * as taskStopImpactModule from "@openducktor/frontend-core/queries/use-task-stop-impact";
import { withMockedToast } from "@/test-utils/mock-toast";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  createSettingsSnapshotFixture,
  createTaskCardFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import type { TaskConfirmRequestAction } from "@openducktor/frontend-core/tasks/workflow/task-confirm-actions";
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
  onDelete: mock(async (_taskId: string) => {}),
  onCloseTask: mock(async (_taskId: string, _options: { removeWorktree: boolean }) => {}),
  onSucceeded: mock((_taskId: string) => {}),
});

const workspaceState = createWorkspaceStateFixture();
const activeWorkspaceValue = {
  activeWorkspace: workspaceState.activeWorkspace,
  setActiveWorkspace: () => {},
};
/** The host reads of the shared close confirmation. */
const closeConfirmationHost = ({
  branchOid = "branch-tip",
  failure,
  readStopImpact = async () => ({ stoppableSessionCount: 0 }),
}: {
  branchOid?: string;
  failure?: { message: string; failedAt: string };
  readStopImpact?: () => Promise<{ stoppableSessionCount: number }>;
} = {}) =>
  createTestClientConnection({
    client: {
      workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      taskWorktreeCleanupImpactGet: async () => ({
        worktreePaths: ["/worktrees/odt-1"],
        branchNames: ["odt/odt-1"],
        uncommittedFileCount: 2,
        mergeCandidate: true,
        branchOid,
      }),
      terminalList: async () => ({ hostInstanceId: "host-1", terminals: [] }),
      taskStopImpactGet: readStopImpact,
      taskMergeStatusGet: async (repoPath) => {
        const status: TaskMergeStatus = {
          taskId: task.id,
          branch: "odt/odt-1",
          targetBranch: { remote: "origin", branch: "main" },
          result: {
            kind: "merged",
            checkedAt: "2026-10-01T00:00:00.000Z",
            branchOid: "branch-tip",
          },
        };
        // A failed later check keeps the last successful result.
        if (failure) status.failure = failure;
        return { repoPath, tasks: [status] };
      },
    },
  });

let confirmTaskAction: (taskId: string, action: TaskConfirmRequestAction) => void = () => {};

/** The host as `TaskWorkflowActionsProvider` mounts it, with a focusable element beside it. */
function Host({
  connection,
  ...props
}: HostProps & { connection?: ReturnType<typeof createTestClientConnection> }): ReactElement {
  const { onConfirmTaskAction, model } = useTaskConfirmDialogHost(props);
  confirmTaskAction = onConfirmTaskAction;
  return (
    <QueryProvider {...(connection ? { connection } : {})}>
      <WorkspaceStateContext.Provider value={workspaceState}>
        <ActiveWorkspaceContext value={activeWorkspaceValue}>
          <button type="button">Before the palette</button>
          <TaskConfirmDialogHost model={model} />
        </ActiveWorkspaceContext>
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
    ["delete", "onDelete", [task.id]],
  ] as const)(
    "runs the confirmed %s through %s, then reports the success",
    async (action, handlerName, expectedArgs) => {
      // The test has no host bridge, so the stop impact comes from a local fake.
      const stopImpactSpy = spyOn(taskStopImpactModule, "useTaskStopImpact").mockReturnValue({
        stoppableSessionCount: 0,
        removedWorktreeCount: null,
        isLoading: false,
        error: null,
        retry: () => {},
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

  test("opens the shared close confirmation and closes with the chosen cleanup", async () => {
    const stopImpactSpy = spyOn(taskStopImpactModule, "useTaskStopImpact").mockReturnValue({
      stoppableSessionCount: 0,
      removedWorktreeCount: null,
      isLoading: false,
      error: null,
      retry: () => {},
    });
    try {
      const handlers = createHandlers();
      view = render(
        <Host workspaceIdentity={workspaceA} connection={closeConfirmationHost()} {...handlers} />,
      );
      await request("close");

      expect(screen.getByRole("dialog", { name: "Close Task" })).toBeTruthy();
      expect(await screen.findByText("Branch merged into origin/main.")).toBeTruthy();
      const checkbox = await screen.findByRole("switch", {
        name: "Remove worktree and branch",
      });
      await waitFor(() => expect(checkbox.getAttribute("data-state")).toBe("checked"));
      expect(screen.getByText("2 uncommitted files")).toBeTruthy();

      fireEvent.click(checkbox);
      expect(checkbox.getAttribute("data-state")).toBe("unchecked");
      expect(screen.getByText("/worktrees/odt-1")).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Close Task" }));
      });
      await settle();

      expect(handlers.onCloseTask).toHaveBeenCalledWith(task.id, { removeWorktree: false });
      expect(handlers.onSucceeded).toHaveBeenCalledWith(task.id);
    } finally {
      stopImpactSpy.mockRestore();
    }
  });

  test("warns when the task branch moved after the merged result", async () => {
    const stopImpactSpy = spyOn(taskStopImpactModule, "useTaskStopImpact").mockReturnValue({
      stoppableSessionCount: 0,
      removedWorktreeCount: null,
      isLoading: false,
      error: null,
      retry: () => {},
    });
    try {
      view = render(
        <Host
          workspaceIdentity={workspaceA}
          connection={closeConfirmationHost({ branchOid: "new-commit" })}
          {...createHandlers()}
        />,
      );
      await request("close");

      expect(
        await screen.findByText(
          "The task branch changed after the last check. Merge status not checked yet.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText("Branch merged into origin/main.")).toBeNull();
    } finally {
      stopImpactSpy.mockRestore();
    }
  });

  test("keeps a failed check visible when the task branch moved after the last result", async () => {
    const stopImpactSpy = spyOn(taskStopImpactModule, "useTaskStopImpact").mockReturnValue({
      stoppableSessionCount: 0,
      removedWorktreeCount: null,
      isLoading: false,
      error: null,
      retry: () => {},
    });
    try {
      view = render(
        <Host
          workspaceIdentity={workspaceA}
          connection={closeConfirmationHost({
            branchOid: "new-commit",
            failure: {
              message: "Fetch origin failed: authentication required.",
              failedAt: "2026-10-02T00:00:00.000Z",
            },
          })}
          {...createHandlers()}
        />,
      );
      await request("close");

      expect(await screen.findByText("Fetch origin failed: authentication required.")).toBeTruthy();
      expect(
        screen.getByText(
          /^Last successful check: .+\. The task branch changed after that check\.$/,
        ),
      ).toBeTruthy();
      expect(screen.queryByText("Branch merged into origin/main.")).toBeNull();
    } finally {
      stopImpactSpy.mockRestore();
    }
  });

  test("shows a failed session read in the read error row and retries it", async () => {
    let failRead = true;
    const readStopImpact = mock(async () => {
      if (failRead) throw new Error("runtime disconnected");
      return { stoppableSessionCount: 0 };
    });
    view = render(
      <Host
        workspaceIdentity={workspaceA}
        connection={closeConfirmationHost({ readStopImpact })}
        {...createHandlers()}
      />,
    );
    await request("close");

    const message =
      "Unable to check how many active sessions will be stopped: runtime disconnected";
    expect(await screen.findByText(message)).toBeTruthy();
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: "Close Task" });
    expect(confirm.disabled).toBe(true);

    failRead = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    await settle();
    await waitFor(() => expect(screen.queryByText(message)).toBeNull());
    expect(readStopImpact).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(confirm.disabled).toBe(false));
  });

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
