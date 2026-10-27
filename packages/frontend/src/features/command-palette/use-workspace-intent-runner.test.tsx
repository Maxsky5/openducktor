import { afterEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { type ReactElement, useEffect, useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import {
  useWorkspacePreviewTransitionGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import { TaskWorkflowActionsContext } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { TasksStateContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { useWorkspaceState } from "@/state/app-state-provider";
import { withMockedToast } from "@/test-utils/mock-toast";
import {
  createTaskCardFixture,
  createTaskWorkflowActionsFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import type { TasksStateContextValue } from "@openducktor/frontend-core/types/state-slices";
import {
  useWorkspaceIntentRunner,
  type WorkspaceIntent,
  type WorkspaceIntentContext,
} from "./use-workspace-intent-runner";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

const alpha = createWorkspaceRecordFixture({ workspaceId: "alpha", workspaceName: "Alpha" });
const beta = createWorkspaceRecordFixture({
  workspaceId: "beta",
  workspaceName: "Beta",
  repoPath: "/beta",
  isActive: false,
});

type HarnessOptions = {
  tasksByWorkspace?: Record<string, TaskCard[]>;
  /** The task read of the active workspace. The task list keeps its old data in each state. */
  taskRead?: "current" | "refreshing" | "failed";
  selectWorkspace?: (workspaceId: string, apply: () => void) => Promise<void>;
  /** A visible page that asks before a transition. It cancels every request. */
  cancelTransitions?: boolean;
};

const createTasksState = (tasks: TaskCard[]): TasksStateContextValue => ({
  tasksAreCurrent: true,
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  isLoadingTasks: false,
  detectingPullRequestTaskIds: new Set<string>(),
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskIds: new Set<string>(),
  pendingMergedPullRequest: null,
  tasks,
  refreshTasks: async () => {},
  syncPullRequests: async () => {},
  linkMergedPullRequest: async () => {},
  cancelLinkMergedPullRequest: () => {},
  unlinkPullRequest: async () => {},
  createTask: async () => {},
  updateTask: async () => {},
  setTaskTargetBranch: async () => {},
  deleteTask: async () => {},
  closeTask: async () => {},
  resetTaskImplementation: async () => {},
  resetTask: async () => {},
  transitionTask: async () => {},
  humanApproveTask: async () => {},
  humanRequestChangesTask: async () => {},
});

let runIntent: ((intent: WorkspaceIntent) => void) | null = null;
let cancelIntent: (() => void) | null = null;
let currentPath = "";
let activeWorkspaceId: string | null = null;

function Probe(): null {
  ({ runIntent, cancelIntent } = useWorkspaceIntentRunner());
  currentPath = useLocation().pathname;
  activeWorkspaceId = useWorkspaceState().activeWorkspace?.workspaceId ?? null;
  return null;
}

function CancellingGuard(): null {
  const { register } = useWorkspacePreviewTransitionGuard();
  useEffect(() => register((_apply, cancel) => cancel?.()), [register]);
  return null;
}

function Harness({
  tasksByWorkspace = {},
  taskRead = "current",
  selectWorkspace,
  cancelTransitions = false,
}: HarnessOptions): ReactElement {
  const [active, setActive] = useState<WorkspaceRecord>(alpha);
  const [isSwitchingWorkspace, setSwitching] = useState(false);
  const tasksState = {
    ...createTasksState(tasksByWorkspace[active.workspaceId] ?? []),
    tasksAreCurrent: taskRead === "current",
    isRefreshingTasksInBackground: taskRead === "refreshing",
  };
  return (
    <MemoryRouter initialEntries={["/kanban"]}>
      <WorkspacePreviewTransitionGuardProvider>
        {cancelTransitions ? <CancellingGuard /> : null}
        <WorkspaceStateContext.Provider
          value={createWorkspaceStateFixture({
            workspaces: [alpha, beta],
            activeWorkspace: active,
            isSwitchingWorkspace,
            selectWorkspace: async (workspaceId) => {
              setSwitching(true);
              const apply = () => {
                setActive(workspaceId === beta.workspaceId ? beta : alpha);
              };
              try {
                if (selectWorkspace) await selectWorkspace(workspaceId, apply);
                else apply();
              } finally {
                setSwitching(false);
              }
            },
          })}
        >
          <TasksStateContext.Provider value={tasksState}>
            <TaskWorkflowActionsContext.Provider value={createTaskWorkflowActionsFixture()}>
              <Probe />
            </TaskWorkflowActionsContext.Provider>
          </TasksStateContext.Provider>
        </WorkspaceStateContext.Provider>
      </WorkspacePreviewTransitionGuardProvider>
    </MemoryRouter>
  );
}

const start = async (intent: WorkspaceIntent): Promise<void> => {
  await act(async () => {
    runIntent?.(intent);
  });
};

afterEach(() => {
  cleanup();
  runIntent = null;
  cancelIntent = null;
  activeWorkspaceId = null;
});

describe("useWorkspaceIntentRunner", () => {
  test("runs an intent of the active workspace and navigates inside the guard", async () => {
    render(<Harness />);
    const ranIn: (string | null)[] = [];
    const run = mock((context: WorkspaceIntentContext) => {
      ranIn.push(activeWorkspaceId);
      context.navigate("/sessions");
    });

    await start({ workspaceId: alpha.workspaceId, run });

    expect(run).toHaveBeenCalledTimes(1);
    expect(ranIn).toEqual([alpha.workspaceId]);
    await waitFor(() => expect(currentPath).toBe("/sessions"));
  });

  test("makes another workspace active first, then runs the intent there", async () => {
    const task = createTaskCardFixture({ id: "beta-1" });
    const switched = Promise.withResolvers<void>();
    render(
      <Harness
        tasksByWorkspace={{ beta: [task] }}
        selectWorkspace={async (_workspaceId, apply) => {
          await switched.promise;
          apply();
        }}
      />,
    );
    const ranIn: (string | null)[] = [];
    const run = mock((_context: WorkspaceIntentContext) => {
      ranIn.push(activeWorkspaceId);
    });

    await start({ workspaceId: beta.workspaceId, taskId: task.id, run });
    expect(run).not.toHaveBeenCalled();

    await act(async () => switched.resolve());

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(ranIn).toEqual([beta.workspaceId]);
  });

  test("drops the intent when the guard cancels the switch", async () => {
    const selectWorkspace = mock(async () => {});
    render(<Harness cancelTransitions selectWorkspace={selectWorkspace} />);
    const run = mock(() => {});

    await start({ workspaceId: beta.workspaceId, run });

    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  test("drops the intent when the workspace switch fails", async () => {
    render(
      <Harness
        selectWorkspace={async () => {
          throw new Error("Switch failed");
        }}
      />,
    );
    const run = mock(() => {});

    await start({ workspaceId: beta.workspaceId, run });

    expect(run).not.toHaveBeenCalled();
  });

  test("reports a task that the workspace no longer has and does not run", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      render(<Harness tasksByWorkspace={{ beta: [] }} />);
      const run = mock(() => {});

      await start({ workspaceId: beta.workspaceId, taskId: "gone-1", run });

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
      expect(toastErrorMock.mock.calls[0]?.[0]).toBe("Task gone-1 is not in Beta.");
      expect(run).not.toHaveBeenCalled();
    });
  });

  test("waits for a task read in flight, also when the old list has the task", async () => {
    const task = createTaskCardFixture({ id: "beta-1" });
    const view = render(<Harness tasksByWorkspace={{ beta: [task] }} taskRead="refreshing" />);
    const run = mock(() => {});

    await start({ workspaceId: beta.workspaceId, taskId: task.id, run });
    expect(run).not.toHaveBeenCalled();

    view.rerender(<Harness tasksByWorkspace={{ beta: [task] }} taskRead="current" />);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  test("does not run a waiting task intent after it is cancelled", async () => {
    const task = createTaskCardFixture({ id: "beta-1" });
    const view = render(<Harness tasksByWorkspace={{ beta: [task] }} taskRead="refreshing" />);
    const run = mock(() => {});

    await start({ workspaceId: beta.workspaceId, taskId: task.id, run });
    await act(async () => cancelIntent?.());
    view.rerender(<Harness tasksByWorkspace={{ beta: [task] }} taskRead="current" />);
    await act(async () => {});

    expect(run).not.toHaveBeenCalled();
  });

  test("drops a task intent after a failed task read, also when the old list has the task", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const task = createTaskCardFixture({ id: "beta-1" });
      const view = render(<Harness tasksByWorkspace={{ beta: [task] }} taskRead="failed" />);
      const run = mock(() => {});

      await start({ workspaceId: beta.workspaceId, taskId: task.id, run });

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
      expect(toastErrorMock.mock.calls[0]?.[0]).toBe("Tasks of Beta did not load.");
      view.rerender(<Harness tasksByWorkspace={{ beta: [task] }} taskRead="current" />);
      await act(async () => {});
      expect(run).not.toHaveBeenCalled();
    });
  });

  test("runs only the newest intent while a switch is in progress", async () => {
    const switched = Promise.withResolvers<void>();
    render(
      <Harness
        selectWorkspace={async (_workspaceId, apply) => {
          await switched.promise;
          apply();
        }}
      />,
    );
    const older = mock(() => {});
    const newer = mock(() => {});

    await start({ workspaceId: beta.workspaceId, run: older });
    await start({ workspaceId: beta.workspaceId, run: newer });
    await act(async () => switched.resolve());

    await waitFor(() => expect(newer).toHaveBeenCalledTimes(1));
    expect(older).not.toHaveBeenCalled();
  });
});
