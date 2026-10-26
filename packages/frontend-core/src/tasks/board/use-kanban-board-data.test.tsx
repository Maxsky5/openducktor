import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, SettingsSnapshot, TaskCard } from "@openducktor/contracts";
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
  resetTaskImplementation: async () => {},
  resetTask: async () => {},
  transitionTask: async () => {},
  humanApproveTask: async () => {},
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
    connection.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", task.id), []);
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
        connection.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "TASK-1"), [
          session("build-1"),
        ]);
      },
    );
    try {
      await harness.mount();
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
