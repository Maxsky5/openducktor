import { workspaceRefFixture } from "../../test-support/workspace-ref-fixture";
import { workflowQueryKeys } from "../../queries/workflows";
import {
  builtinCompiledCatalogFixture,
  builtinWorkspaceWorkflowsFixture,
} from "../../test-support/workflow-fixtures";
import { type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, SettingsSnapshot } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { TasksStateContext } from "../../app-state/app-state-contexts";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { agentSessionQueryKeys } from "../../queries/agent-sessions";
import { workspaceQueryKeys } from "../../queries/workspace";
import { createHookHarness } from "../../test-support/react-hook-harness";
import {
  createDeferred,
  createSettingsSnapshotFixture,
  createTaskCardFixture,
} from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import type { TasksStateContextValue } from "../../types/state-slices";
import { useKanbanBoardData } from "./use-kanban-board-data";

const tasksState = (tasks: TaskCard[]): TasksStateContextValue => ({
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
  removeTaskWorktree: async () => {},
  resetTaskImplementation: async () => {},
  resetTask: async () => {},
  humanRequestChangesTask: async () => {},
});

const session = (externalSessionId: string): AgentSessionRecord => ({
  externalSessionId,
  role: "build",
  startedAt: "2026-10-01T08:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  selectedModel: null,
});

const renderBoardData = (
  tasks: TaskCard[],
  readSettings: () => Promise<SettingsSnapshot>,
  seed: (connection: ReturnType<typeof createTestClientConnection>) => void = () => {},
) => {
  const connection = createTestClientConnection({
    client: { workspaceGetSettingsSnapshot: readSettings },
  });
  for (const task of tasks) {
    connection.queryClient.setQueryData(
      agentSessionQueryKeys.list(workspaceRefFixture("/repo"), task.id),
      [],
    );
  }
  seed(connection);
  const Wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <ClientConnectionProvider connection={connection}>
      <TasksStateContext.Provider value={tasksState(tasks)}>{children}</TasksStateContext.Provider>
    </ClientConnectionProvider>
  );
  return {
    connection,
    harness: createHookHarness(useKanbanBoardData, BOARD, { wrapper: Wrapper }),
  };
};

const BOARD = { workspaceId: "workspace-1", repoPath: "/repo" };

describe("useKanbanBoardData", () => {
  test("shows the tasks and the saved sessions of each task", async () => {
    const tasks = [
      createTaskCardFixture({ id: "TASK-1" }),
      createTaskCardFixture({ id: "TASK-2" }),
    ];
    const { harness } = renderBoardData(
      tasks,
      async () => createSettingsSnapshotFixture(),
      (connection) => {
        connection.queryClient.setQueryData(
          workspaceQueryKeys.settingsSnapshot(),
          createSettingsSnapshotFixture(),
        );
        connection.queryClient.setQueryData(
          agentSessionQueryKeys.list(workspaceRefFixture("/repo"), "TASK-1"),
          [session("build-1")],
        );
      },
    );
    try {
      await harness.mount();
      await harness.waitFor((board) => !board.isLoadingTasks);
      const board = harness.getLatest();
      expect(board.kanbanTasks).toBe(tasks);
      expect(board.matchingTasks).toBe(tasks);
      expect(board.isLoadingTasks).toBe(false);
      expect(
        board.historicalSessionsByTaskId.get("TASK-1")?.map((entry) => entry.externalSessionId),
      ).toEqual(["build-1"]);
      expect(board.historicalSessionsByTaskId.get("TASK-2")).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("loads in the foreground until the first settings read ends", async () => {
    const settings = createDeferred<SettingsSnapshot>();
    const { harness } = renderBoardData([createTaskCardFixture()], () => settings.promise);
    try {
      await harness.mount();
      expect(harness.getLatest().isLoadingTasks).toBe(true);
      await harness.run(() => settings.resolve(createSettingsSnapshotFixture()));
      await harness.waitFor((board) => !board.isLoadingTasks);
    } finally {
      await harness.unmount();
    }
  });

  test("stops the foreground loader when workflow metadata fails before tasks load", async () => {
    const connection = createTestClientConnection({
      client: {
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        workflowCatalogGet: async () => {
          throw new Error("Host workflow catalog is invalid. Restart the host.");
        },
      },
    });
    const harness = createHookHarness(useKanbanBoardData, BOARD, {
      wrapper: ({ children }: PropsWithChildren) => (
        <ClientConnectionProvider connection={connection}>
          <TasksStateContext value={{ ...tasksState([]), isForegroundLoadingTasks: true }}>
            {children}
          </TasksStateContext>
        </ClientConnectionProvider>
      ),
    });
    try {
      await harness.mount();
      await harness.waitFor((board) => board.workflowQuery.isError);
      expect(harness.getLatest().isLoadingTasks).toBe(false);
      expect(harness.getLatest().kanbanTasks).toEqual([]);
    } finally {
      await harness.unmount();
      await connection.dispose();
    }
  });

  test("reports a failed refreshed context when its cached revision is absent from the new catalog", async () => {
    const connection = createTestClientConnection({
      client: {
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        workspaceWorkflowGet: async () => {
          throw new Error("Workspace board is unavailable");
        },
      },
    });
    connection.queryClient.setQueryData(workflowQueryKeys.catalog, {
      ...builtinCompiledCatalogFixture,
      workflows: new Map(),
    });
    connection.queryClient.setQueryData(
      workflowQueryKeys.workspace(BOARD),
      builtinWorkspaceWorkflowsFixture,
    );
    await connection.queryClient.invalidateQueries({
      queryKey: workflowQueryKeys.workspace(BOARD),
      refetchType: "none",
    });
    const harness = createHookHarness(useKanbanBoardData, BOARD, {
      wrapper: ({ children }: PropsWithChildren) => (
        <ClientConnectionProvider connection={connection}>
          <TasksStateContext value={tasksState([])}>{children}</TasksStateContext>
        </ClientConnectionProvider>
      ),
    });
    try {
      await harness.mount();
      await harness.waitFor((board) => board.workflowQuery.isError);
      expect(harness.getLatest().creationStateId).toBeNull();
      expect(harness.getLatest().isLoadingTasks).toBe(false);
      expect(harness.getLatest().kanbanTasks).toEqual([]);
    } finally {
      await harness.unmount();
      await connection.dispose();
    }
  });

  test("hides the tasks while the settings read fails", async () => {
    const { harness } = renderBoardData([createTaskCardFixture()], async () => {
      throw new Error("Host unreachable");
    });
    try {
      await harness.mount();
      await harness.waitFor((board) => board.settingsQuery.isError);
      expect(harness.getLatest().kanbanTasks).toEqual([]);
      expect(harness.getLatest().matchingTasks).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });
});
