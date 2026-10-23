import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  ExternalTaskSyncEvent,
  TaskAgentSessions,
} from "@openducktor/contracts";
import { CancelledError, QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  agentSessionListQueryOptions,
  agentSessionQueryKeys,
  updateAgentSessionListQuery,
} from "./agent-sessions";
import {
  type AgentSessionViewReadPort,
  createAgentSessionViewSync,
} from "./agent-session-view-sync";
import { repoTaskIdsQueryOptions } from "./tasks";

const event = (
  taskIds: string[],
  removedTaskIds: string[] = [],
  repoPath = "/repo",
): ExternalTaskSyncEvent => ({
  kind: "tasks_updated",
  boardChanges: null,
  eventId: `event-${taskIds.join("-")}`,
  repoPath,
  taskIds,
  removedTaskIds,
  statusChanges: [],
  taskSnapshots: [],
  emittedAt: "2026-09-03T20:00:00.000Z",
});

const session = (externalSessionId: string): AgentSessionRecord => ({
  externalSessionId,
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-09-03T20:00:00.000Z",
  selectedModel: null,
});

type BatchRead = (repoPath: string, taskIds: string[]) => Promise<TaskAgentSessions[]>;

const createReadPort = (agentSessionsListForTasks: BatchRead, existingTaskIds: string[] = []) => ({
  agentSessionsListForTasks: mock(agentSessionsListForTasks),
  taskIdsList: mock(async (_repoPath: string) => existingTaskIds),
});

const recordsFrom =
  (recordsByTaskId: Record<string, AgentSessionRecord[]>): BatchRead =>
  async (_repoPath, taskIds) =>
    taskIds.map((taskId) => ({ taskId, agentSessions: recordsByTaskId[taskId] ?? [] }));

const waitForReads = async (
  readPort: { agentSessionsListForTasks: { mock: { calls: unknown[] } } },
  count: number,
): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (readPort.agentSessionsListForTasks.mock.calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Expected ${count} session-list requests.`);
};

const createHarness = (
  readPort: AgentSessionViewReadPort,
  {
    sessionTaskIds = [],
    closedRepoPaths = new Set<string>(),
    activeRepoPath = "/repo",
  }: { sessionTaskIds?: string[]; closedRepoPaths?: Set<string>; activeRepoPath?: string } = {},
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const listSessionTaskIds = mock((_repoPath: string) => sessionTaskIds);
  const removeTaskSessions = mock((_repoPath: string, _taskIds: string[]) => {});
  const refreshLiveSessions = mock(async (_repoPath: string) => undefined);
  const subscriptions: (() => void)[] = [];
  const sync = createAgentSessionViewSync({
    queryClient,
    readPort,
    listSessionTaskIds,
    removeTaskSessions,
    refreshLiveSessions,
    isWorkspaceOpen: (repoPath) => !closedRepoPaths.has(repoPath),
    isWorkspaceActive: (repoPath) => repoPath === activeRepoPath,
  });
  return {
    queryClient,
    removeTaskSessions,
    refreshLiveSessions,
    sync,
    /** Admit consecutive events and complete them together, like the task stream. */
    reconcile: (events: ExternalTaskSyncEvent[]) =>
      sync.completeExternalEvents(
        events.map((event) => sync.admitExternalEvent(event)),
        () => true,
      ),
    /** Mount a view of a task list, like a session list hook. Without records, the view reads. */
    observe: (taskId: string, records: AgentSessionRecord[] | null = [], repoPath = "/repo") => {
      if (records) queryClient.setQueryData(agentSessionQueryKeys.list(repoPath, taskId), records);
      const observer = new QueryObserver(
        queryClient,
        agentSessionListQueryOptions(repoPath, taskId, readPort),
      );
      subscriptions.push(observer.subscribe(() => {}));
      return observer;
    },
    records: (taskId: string, repoPath = "/repo") =>
      queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list(repoPath, taskId)),
    dispose: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      queryClient.clear();
    },
  };
};

const holdFirstLiveRefresh = (harness: ReturnType<typeof createHarness>) => {
  const pending = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  harness.refreshLiveSessions.mockImplementation(async (repoPath: string) => {
    if (repoPath !== "/repo-a") return;
    started.resolve();
    await pending.promise;
  });
  return { pending, started: started.promise };
};

describe("AgentSessionViewSync", () => {
  for (const size of [1, 100]) {
    test(`refreshes ${size} observed task lists with one host request`, async () => {
      const taskIds = Array.from({ length: size }, (_, index) => `task-${index}`);
      const freshRecords = Object.fromEntries(
        taskIds.map((taskId, index) => [taskId, index % 2 === 0 ? [session(taskId)] : []]),
      );
      const readPort = createReadPort(recordsFrom(freshRecords));
      const harness = createHarness(readPort);
      try {
        for (const taskId of taskIds) harness.observe(taskId);

        await harness.reconcile([event(taskIds)]);

        expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([
          ["/repo", [...taskIds].sort()],
        ]);
        for (const taskId of taskIds) expect(harness.records(taskId)).toEqual(freshRecords[taskId]);
        expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo"]]);
      } finally {
        harness.dispose();
      }
    });
  }

  test("reconciles consecutive events with one request for each workspace", async () => {
    const readPort = createReadPort(recordsFrom({ "task-1": [session("moved")] }));
    const harness = createHarness(readPort);
    try {
      harness.observe("task-1");
      harness.observe("task-2", [session("moved")]);
      harness.observe("other-task", [], "/other-repo");

      // The session moves from task-2 to task-1, and both owners refresh together.
      await harness.reconcile([
        event(["task-1"]),
        event(["task-1", "task-2"]),
        event(["other-task"], [], "/other-repo"),
      ]);

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([
        ["/repo", ["task-1", "task-2"]],
        ["/other-repo", ["other-task"]],
      ]);
      expect(harness.records("task-1")).toEqual([session("moved")]);
      expect(harness.records("task-2")).toEqual([]);
      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo"]]);
    } finally {
      harness.dispose();
    }
  });

  test("a later removal in the same run removes the task without reading it", async () => {
    const readPort = createReadPort(recordsFrom({}));
    const harness = createHarness(readPort);
    try {
      harness.observe("task-1", [session("removed")]);
      harness.observe("task-2");

      await harness.reconcile([event(["task-1", "task-2"]), event(["task-1"], ["task-1"])]);

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([["/repo", ["task-2"]]]);
      expect(harness.records("task-1")).toEqual([]);
      expect(harness.removeTaskSessions).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(harness.refreshLiveSessions).not.toHaveBeenCalled();
    } finally {
      harness.dispose();
    }
  });

  test("a change during a read reads the task again before it completes", async () => {
    const olderRead = Promise.withResolvers<TaskAgentSessions[]>();
    const olderReadSent = Promise.withResolvers<void>();
    const readPort = createReadPort(async (repoPath, taskIds) => {
      if (readPort.agentSessionsListForTasks.mock.calls.length > 1) {
        return recordsFrom({ "task-1": [session("newer")] })(repoPath, taskIds);
      }
      olderReadSent.resolve();
      return olderRead.promise;
    });
    const harness = createHarness(readPort);
    try {
      harness.observe("task-1");
      const first = harness.reconcile([event(["task-1"])]);
      await olderReadSent.promise;
      const second = harness.reconcile([event(["task-1"])]);
      olderRead.resolve([{ taskId: "task-1", agentSessions: [session("older")] }]);
      await Promise.all([first, second]);

      expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(2);
      expect(harness.records("task-1")).toEqual([session("newer")]);
    } finally {
      harness.dispose();
    }
  });

  test.each([
    { change: "a committed session update", committed: true },
    { change: "an external cancellation", committed: false },
  ])("handles $change during a task-event refresh", async ({ committed }) => {
    const olderRead = Promise.withResolvers<TaskAgentSessions[]>();
    const readStarted = Promise.withResolvers<void>();
    const readPort = createReadPort(() => {
      readStarted.resolve();
      return olderRead.promise;
    });
    const harness = createHarness(readPort);
    try {
      harness.observe("task-1");
      const refreshing = harness.reconcile([event(["task-1"])]);
      const result = refreshing.then(
        () => ({ ok: true }),
        (error: CancelledError) => ({ ok: false, error }),
      );
      await readStarted.promise;
      if (committed) {
        updateAgentSessionListQuery(harness.queryClient, "/repo", {
          taskId: "task-1",
          agentSessions: [session("committed")],
        });
        expect(await result).toEqual({ ok: true });
        expect(harness.refreshLiveSessions).toHaveBeenCalledWith("/repo");
      } else {
        await harness.queryClient.cancelQueries(
          { queryKey: agentSessionQueryKeys.list("/repo", "task-1"), exact: true },
          { revert: false },
        );
        expect(await result).toEqual({ ok: false, error: expect.any(CancelledError) });
        expect(harness.refreshLiveSessions).not.toHaveBeenCalled();
      }
      olderRead.resolve([{ taskId: "task-1", agentSessions: [] }]);
      await olderRead.promise;

      expect(harness.records("task-1")).toEqual(committed ? [session("committed")] : []);
      expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
    } finally {
      olderRead.resolve([{ taskId: "task-1", agentSessions: [] }]);
      harness.dispose();
    }
  });

  test("leaves unobserved lists stale without a request", async () => {
    const readPort = createReadPort(recordsFrom({}));
    const harness = createHarness(readPort);
    try {
      harness.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), []);

      await harness.reconcile([event(["task-1"])]);

      expect(readPort.agentSessionsListForTasks).not.toHaveBeenCalled();
      expect(
        harness.queryClient.getQueryState(agentSessionQueryKeys.list("/repo", "task-1"))
          ?.isInvalidated,
      ).toBe(true);
    } finally {
      harness.dispose();
    }
  });

  test("does not refresh live sessions when membership and ownership are unchanged", async () => {
    const readPort = createReadPort(recordsFrom({ "task-1": [session("same")] }));
    const harness = createHarness(readPort);
    try {
      harness.observe("task-1", [session("same")]);

      await harness.reconcile([event(["task-1"])]);

      expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
      expect(harness.refreshLiveSessions).not.toHaveBeenCalled();
    } finally {
      harness.dispose();
    }
  });

  test("reports session record refresh failures and keeps loaded records", async () => {
    const readPort = createReadPort(async () => {
      throw new Error("session records unavailable");
    });
    const harness = createHarness(readPort);
    try {
      harness.observe("task-1", [session("loaded")]);

      await expect(harness.reconcile([event(["task-1"])])).rejects.toThrow(
        "session records unavailable",
      );

      const state = harness.queryClient.getQueryState(
        agentSessionQueryKeys.list("/repo", "task-1"),
      );
      expect(state?.status).toBe("error");
      expect(state?.data).toEqual([session("loaded")]);
      expect(harness.refreshLiveSessions).not.toHaveBeenCalled();
    } finally {
      harness.dispose();
    }
  });

  test("rejects a batch response that omits a requested task", async () => {
    const readPort = createReadPort(async () => [{ taskId: "task-1", agentSessions: [] }]);
    const harness = createHarness(readPort);
    try {
      harness.observe("task-1");
      harness.observe("task-2");

      await expect(harness.reconcile([event(["task-1", "task-2"])])).rejects.toThrow(
        'Batch session response omitted task "task-2".',
      );
    } finally {
      harness.dispose();
    }
  });

  test("clears session state without rereading a deleted task", async () => {
    const readPort = createReadPort(recordsFrom({}));
    const harness = createHarness(readPort);
    try {
      harness.observe("task-1", [session("deleted-task-session")]);

      await harness.reconcile([event(["task-1"], ["task-1"])]);

      expect(harness.records("task-1")).toEqual([]);
      expect(readPort.agentSessionsListForTasks).not.toHaveBeenCalled();
      expect(harness.removeTaskSessions).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(harness.refreshLiveSessions).not.toHaveBeenCalled();
    } finally {
      harness.dispose();
    }
  });

  test("a deleted task leaves the next request without its read", async () => {
    const readPort = createReadPort(recordsFrom({}));
    const harness = createHarness(readPort);
    try {
      // Both views start a read for the next request. The removal cancels one of them.
      harness.observe("task-1", null);
      harness.observe("task-2", null);
      await harness.reconcile([event([], ["task-1"])]);
      await Promise.resolve();

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([["/repo", ["task-2"]]]);
      expect(harness.records("task-1")).toEqual([]);
      expect(harness.removeTaskSessions).toHaveBeenCalledWith("/repo", ["task-1"]);
    } finally {
      harness.dispose();
    }
  });

  test("reloads task session records and live sessions for a stream snapshot", async () => {
    const readPort = createReadPort(recordsFrom({ "task-1": [session("current")] }));
    const harness = createHarness(readPort);
    try {
      await harness.sync.reconcileStreamSnapshot(new Map([["/repo", ["task-1"]]]), () => true);

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([["/repo", ["task-1"]]]);
      expect(readPort.taskIdsList).not.toHaveBeenCalled();
      expect(harness.records("task-1")).toEqual([session("current")]);
      expect(harness.refreshLiveSessions).toHaveBeenCalledWith("/repo");
    } finally {
      harness.dispose();
    }
  });

  test("a stream snapshot keeps the sessions of hidden tasks that still exist", async () => {
    const readPort = createReadPort(recordsFrom({}), ["current-task", "hidden-done-task"]);
    const harness = createHarness(readPort);
    try {
      for (const taskId of ["deleted-task", "hidden-done-task"]) {
        harness.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", taskId), [
          session(taskId),
        ]);
      }
      harness.queryClient.setQueryData(agentSessionQueryKeys.list("/other-repo", "other-task"), [
        session("other-task"),
      ]);

      // The Kanban list omits done tasks after the visible period.
      await harness.sync.reconcileStreamSnapshot(
        new Map([["/repo", ["current-task"]]]),
        () => true,
      );

      expect(readPort.taskIdsList.mock.calls).toEqual([["/repo"]]);
      expect(harness.removeTaskSessions.mock.calls).toEqual([["/repo", ["deleted-task"]]]);
      expect(harness.records("deleted-task")).toBeUndefined();
      expect(harness.records("other-task", "/other-repo")).toBeUndefined();
      expect(harness.records("current-task")).toEqual([]);
      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([["/repo", ["current-task"]]]);
    } finally {
      harness.dispose();
    }
  });

  test("a stream snapshot removes a deleted task whose list query expired", async () => {
    const readPort = createReadPort(recordsFrom({}), ["current-task", "hidden-done-task"]);
    const harness = createHarness(readPort, {
      sessionTaskIds: ["deleted-task", "hidden-done-task"],
    });
    try {
      await harness.sync.reconcileStreamSnapshot(
        new Map([["/repo", ["current-task"]]]),
        () => true,
      );

      expect(readPort.taskIdsList.mock.calls).toEqual([["/repo"]]);
      expect(harness.removeTaskSessions.mock.calls).toEqual([["/repo", ["deleted-task"]]]);
    } finally {
      harness.dispose();
    }
  });

  test("a stream snapshot removes the sessions of tasks deleted in every open workspace", async () => {
    const readPort = createReadPort(recordsFrom({ "task-b": [session("b")] }));
    readPort.taskIdsList = mock(async (repoPath: string) =>
      repoPath === "/repo-b" ? ["task-b"] : ["task-a"],
    );
    const harness = createHarness(readPort, { activeRepoPath: "/repo-a" });
    try {
      harness.queryClient.setQueryData(agentSessionQueryKeys.list("/repo-b", "deleted-b"), [
        session("orphan"),
      ]);
      harness.observe("task-b", [], "/repo-b");

      await harness.sync.reconcileStreamSnapshot(
        new Map([
          ["/repo-a", ["task-a"]],
          ["/repo-b", ["task-b"]],
        ]),
        () => true,
      );

      expect(readPort.taskIdsList.mock.calls).toEqual([["/repo-b"]]);
      expect(harness.removeTaskSessions).toHaveBeenCalledWith("/repo-b", ["deleted-b"]);
      expect(harness.removeTaskSessions.mock.calls.flatMap(([, taskIds]) => taskIds)).toEqual([
        "deleted-b",
      ]);
      expect(harness.records("deleted-b", "/repo-b")).toBeUndefined();
      expect(harness.records("task-b", "/repo-b")).toEqual([session("b")]);
      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"], ["/repo-b"]]);
    } finally {
      harness.dispose();
    }
  });

  test("a stream snapshot reads every list of the active workspace and the observed lists of others", async () => {
    const readPort = createReadPort(recordsFrom({}));
    const harness = createHarness(readPort, { activeRepoPath: "/repo-a" });
    try {
      harness.observe("observed-b", [], "/repo-b");

      await harness.sync.reconcileStreamSnapshot(
        new Map([
          ["/repo-a", ["unobserved-a"]],
          ["/repo-b", ["observed-b", "unobserved-b"]],
        ]),
        () => true,
      );

      expect(
        readPort.agentSessionsListForTasks.mock.calls.toSorted(([left], [right]) =>
          left.localeCompare(right),
        ),
      ).toEqual([
        ["/repo-a", ["unobserved-a"]],
        ["/repo-b", ["observed-b"]],
      ]);
      expect(harness.records("unobserved-b", "/repo-b")).toBeUndefined();
    } finally {
      harness.dispose();
    }
  });

  test("a stream snapshot keeps a failed workspace from stopping the other workspaces", async () => {
    const liveFailure = new Error("live refresh failed");
    const readPort = createReadPort(recordsFrom({ "task-a": [session("a")] }));
    const harness = createHarness(readPort, { activeRepoPath: "/repo-a" });
    harness.refreshLiveSessions.mockImplementation(async (repoPath: string) => {
      if (repoPath === "/repo-b") throw liveFailure;
    });
    try {
      const failures = await harness.sync.reconcileStreamSnapshot(
        new Map([
          ["/repo-a", ["task-a"]],
          ["/repo-b", ["task-b"]],
        ]),
        () => true,
      );

      expect(failures).toEqual(new Map([["/repo-b", liveFailure]]));
      expect(harness.records("task-a", "/repo-a")).toEqual([session("a")]);
      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"], ["/repo-b"]]);
    } finally {
      harness.dispose();
    }
  });

  test("queues live refreshes across workspaces while foreground reads can complete", async () => {
    const readPort = createReadPort(recordsFrom({}), ["foreground-task"]);
    const harness = createHarness(readPort);
    const { pending: firstRefresh, started: firstStarted } = holdFirstLiveRefresh(harness);
    try {
      const snapshot = harness.sync.reconcileStreamSnapshot(
        new Map([
          ["/repo-a", []],
          ["/repo-b", []],
        ]),
        () => true,
      );
      await firstStarted;

      const taskIds = await harness.queryClient.fetchQuery(
        repoTaskIdsQueryOptions("/foreground", readPort),
      );

      expect(taskIds).toEqual(["foreground-task"]);
      expect(readPort.taskIdsList.mock.calls).toEqual([["/foreground"]]);
      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"]]);

      firstRefresh.resolve();
      expect(await snapshot).toEqual(new Map());
      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"], ["/repo-b"]]);
    } finally {
      firstRefresh.resolve();
      harness.dispose();
    }
  });

  test("a replacement sync shares the live refresh queue of its query client", async () => {
    const readPort = createReadPort(recordsFrom({}));
    const harness = createHarness(readPort);
    const { pending: firstRefresh, started: firstStarted } = holdFirstLiveRefresh(harness);
    const replacement = createAgentSessionViewSync({
      queryClient: harness.queryClient,
      readPort,
      listSessionTaskIds: () => [],
      removeTaskSessions: harness.removeTaskSessions,
      refreshLiveSessions: harness.refreshLiveSessions,
      isWorkspaceOpen: () => true,
      isWorkspaceActive: () => false,
    });
    try {
      const first = harness.sync.reconcileStreamSnapshot(new Map([["/repo-a", []]]), () => true);
      await firstStarted;

      const second = replacement.reconcileStreamSnapshot(new Map([["/repo-b", []]]), () => true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"]]);

      firstRefresh.resolve();
      await Promise.all([first, second]);
      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"], ["/repo-b"]]);
    } finally {
      firstRefresh.resolve();
      harness.dispose();
    }
  });

  test("a failed live refresh reaches its caller and lets the next workspace refresh", async () => {
    const failure = new Error("live refresh failed");
    const readPort = createReadPort(
      recordsFrom({ "task-a": [session("a")], "task-b": [session("b")] }),
    );
    const harness = createHarness(readPort);
    const { pending: firstRefresh, started: firstStarted } = holdFirstLiveRefresh(harness);
    try {
      harness.observe("task-a", [], "/repo-a");
      harness.observe("task-b", [], "/repo-b");
      const first = harness.reconcile([event(["task-a"], [], "/repo-a")]).then(
        () => null,
        (error: Error) => error,
      );
      await firstStarted;
      const second = harness.reconcile([event(["task-b"], [], "/repo-b")]);
      await waitForReads(readPort, 2);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"]]);

      firstRefresh.reject(failure);
      expect(await first).toBe(failure);
      await second;
      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"], ["/repo-b"]]);
    } finally {
      firstRefresh.resolve();
      harness.dispose();
    }
  });

  test.each([{ reopened: false }, { reopened: true }])(
    "a queued live refresh skips a released workspace, reopened: $reopened",
    async ({ reopened }) => {
      const readPort = createReadPort(recordsFrom({}));
      const closedRepoPaths = new Set<string>();
      const harness = createHarness(readPort, { closedRepoPaths });
      const { pending: firstRefresh, started: firstStarted } = holdFirstLiveRefresh(harness);
      try {
        const snapshot = harness.sync.reconcileStreamSnapshot(
          new Map([
            ["/repo-a", []],
            ["/repo-b", []],
          ]),
          () => true,
        );
        await firstStarted;

        closedRepoPaths.add("/repo-b");
        await harness.sync.releaseWorkspace("/repo-b");
        if (reopened) closedRepoPaths.delete("/repo-b");
        firstRefresh.resolve();
        expect(await snapshot).toEqual(new Map());

        expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"]]);
      } finally {
        firstRefresh.resolve();
        harness.dispose();
      }
    },
  );

  test.each([{ supersession: "replacement snapshot" }, { supersession: "stopped stream" }])(
    "a queued live refresh skips work superseded by a $supersession",
    async ({ supersession }) => {
      const readPort = createReadPort(recordsFrom({}));
      const harness = createHarness(readPort);
      const { pending: firstRefresh, started: firstStarted } = holdFirstLiveRefresh(harness);
      let currentOwner = true;
      try {
        const snapshot = harness.sync.reconcileStreamSnapshot(
          new Map([
            ["/repo-a", []],
            ["/repo-b", []],
          ]),
          () => currentOwner,
        );
        await firstStarted;

        if (supersession === "replacement snapshot") harness.sync.cancelReads();
        else currentOwner = false;
        firstRefresh.resolve();
        await snapshot;

        expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"]]);
      } finally {
        firstRefresh.resolve();
        harness.dispose();
      }
    },
  );

  test("a stream snapshot does no session work for a workspace that closed", async () => {
    const readPort = createReadPort(recordsFrom({ "task-a": [session("a")] }));
    const harness = createHarness(readPort, {
      closedRepoPaths: new Set(["/closed"]),
      activeRepoPath: "/repo-a",
    });
    try {
      await harness.sync.reconcileStreamSnapshot(
        new Map([
          ["/repo-a", ["task-a"]],
          ["/closed", ["task-closed"]],
        ]),
        () => true,
      );

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([["/repo-a", ["task-a"]]]);
      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"]]);
      expect(harness.records("task-closed", "/closed")).toBeUndefined();
    } finally {
      harness.dispose();
    }
  });

  test("an event batch starts no live refresh for a workspace that closed while it waited", async () => {
    const pendingRead = Promise.withResolvers<TaskAgentSessions[]>();
    const readPort = createReadPort(async (repoPath, taskIds) =>
      repoPath === "/repo-a"
        ? pendingRead.promise
        : taskIds.map((taskId) => ({ taskId, agentSessions: [session("b-new")] })),
    );
    const closedRepoPaths = new Set<string>();
    const harness = createHarness(readPort, { closedRepoPaths, activeRepoPath: "/repo-a" });
    try {
      harness.observe("task-a", [session("a-old")], "/repo-a");
      harness.observe("task-b", [session("b-old")], "/repo-b");
      const completion = harness.reconcile([
        event(["task-a"], [], "/repo-a"),
        event(["task-b"], [], "/repo-b"),
      ]);
      await waitForReads(readPort, 2);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(harness.records("task-b", "/repo-b")).toEqual([session("b-new")]);

      closedRepoPaths.add("/repo-b");
      await harness.sync.releaseWorkspace("/repo-b");
      pendingRead.resolve([{ taskId: "task-a", agentSessions: [session("a-new")] }]);
      await completion;

      expect(harness.refreshLiveSessions.mock.calls).toEqual([["/repo-a"]]);
      expect(harness.records("task-b", "/repo-b")).toBeUndefined();
    } finally {
      harness.dispose();
    }
  });

  test("an event batch finishes when a release cancels the reads of a workspace that closed", async () => {
    const pendingRead = Promise.withResolvers<TaskAgentSessions[]>();
    const readPort = createReadPort(() => pendingRead.promise);
    const closedRepoPaths = new Set<string>();
    const harness = createHarness(readPort, { closedRepoPaths, activeRepoPath: "/repo-a" });
    try {
      harness.observe("task-b", [session("b-old")], "/repo-b");
      const completion = harness.reconcile([event(["task-b"], [], "/repo-b")]);
      await waitForReads(readPort, 1);

      closedRepoPaths.add("/repo-b");
      await harness.sync.releaseWorkspace("/repo-b");
      await completion;

      expect(harness.refreshLiveSessions).not.toHaveBeenCalled();
      expect(harness.records("task-b", "/repo-b")).toBeUndefined();
    } finally {
      pendingRead.resolve([]);
      harness.dispose();
    }
  });

  test("releasing a workspace drops its lists and keeps the lists of other workspaces", async () => {
    const readPort = createReadPort(recordsFrom({}));
    const harness = createHarness(readPort);
    try {
      harness.queryClient.setQueryData(agentSessionQueryKeys.list("/closed", "task-1"), [
        session("closed"),
      ]);
      harness.queryClient.setQueryData(agentSessionQueryKeys.list("/open", "task-1"), [
        session("open"),
      ]);

      await harness.sync.releaseWorkspace("/closed");
      await harness.reconcile([event(["task-1"], [], "/closed")]);

      expect(harness.records("task-1", "/closed")).toBeUndefined();
      expect(harness.records("task-1", "/open")).toEqual([session("open")]);
      expect(readPort.agentSessionsListForTasks).not.toHaveBeenCalled();
      expect(harness.refreshLiveSessions).not.toHaveBeenCalled();
    } finally {
      harness.dispose();
    }
  });

  test("a failed inactive list read fails the stream snapshot and keeps loaded records", async () => {
    const readPort = createReadPort(async () => {
      throw new Error("inactive read failed");
    });
    const harness = createHarness(readPort);
    try {
      harness.observe("observed-task", [session("loaded")], "/other-repo");

      await expect(
        harness.sync.reconcileStreamSnapshot(new Map([["/repo", []]]), () => true),
      ).rejects.toThrow("inactive read failed");

      const state = harness.queryClient.getQueryState(
        agentSessionQueryKeys.list("/other-repo", "observed-task"),
      );
      expect(state?.status).toBe("error");
      expect(state?.data).toEqual([session("loaded")]);
    } finally {
      harness.dispose();
    }
  });

  test("a stream snapshot keeps mounted views on their canonical queries", async () => {
    const readPort = createReadPort(recordsFrom({ survivor: [session("fresh-survivor")] }), [
      "survivor",
    ]);
    const harness = createHarness(readPort);
    try {
      const survivor = harness.observe("survivor", [session("old-survivor")]);
      const deleted = harness.observe("deleted", [session("orphan")]);

      await harness.sync.reconcileStreamSnapshot(new Map([["/repo", ["survivor"]]]), () => true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([["/repo", ["survivor"]]]);
      expect(harness.removeTaskSessions.mock.calls).toEqual([["/repo", ["deleted"]]]);
      expect(survivor.getCurrentResult().data).toEqual([session("fresh-survivor")]);
      expect(harness.records("survivor")).toEqual([session("fresh-survivor")]);
      expect(deleted.getCurrentResult()).toMatchObject({ status: "success", data: [] });
      expect(harness.records("deleted")).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test("a stream snapshot keeps an observed list whose new records equal earlier ones", async () => {
    // Each host response has new arrays, as a real response does.
    const readPort = createReadPort(async (_repoPath, taskIds) =>
      taskIds.map((taskId) => ({ taskId, agentSessions: [session("same")] })),
    );
    const harness = createHarness(readPort);
    try {
      const observer = harness.observe("task-1", null);
      await waitForReads(readPort, 1);
      await new Promise((resolve) => setTimeout(resolve, 0));

      await harness.sync.reconcileStreamSnapshot(new Map([["/repo", ["task-1"]]]), () => true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(2);
      expect(observer.getCurrentResult()).toMatchObject({
        status: "success",
        data: [session("same")],
      });
    } finally {
      harness.dispose();
    }
  });

  test("a stream snapshot reads an observed hidden task that still exists in place", async () => {
    const readPort = createReadPort(recordsFrom({ hidden: [session("fresh-hidden")] }), [
      "current",
      "hidden",
    ]);
    const harness = createHarness(readPort);
    try {
      const hidden = harness.observe("hidden", [session("old-hidden")]);

      await harness.sync.reconcileStreamSnapshot(new Map([["/repo", ["current"]]]), () => true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([
        ["/repo", ["current", "hidden"]],
      ]);
      expect(harness.removeTaskSessions.mock.calls).toEqual([["/repo", []]]);
      expect(hidden.getCurrentResult().data).toEqual([session("fresh-hidden")]);
    } finally {
      harness.dispose();
    }
  });

  test("a deletion during a shared read lets the other lists read again", async () => {
    const sharedRead = Promise.withResolvers<TaskAgentSessions[]>();
    const readPort = createReadPort(async (repoPath, taskIds) =>
      readPort.agentSessionsListForTasks.mock.calls.length === 1
        ? sharedRead.promise
        : recordsFrom({ "task-b": [session("b")] })(repoPath, taskIds),
    );
    const harness = createHarness(readPort);
    try {
      const survivor = harness.observe("task-b", null);
      harness.observe("task-a", null);
      await waitForReads(readPort, 1);

      const deleting = harness.reconcile([event([], ["task-a"])]);
      sharedRead.reject(new Error("Task not found: task-a"));
      await deleting;
      await waitForReads(readPort, 2);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([
        ["/repo", ["task-a", "task-b"]],
        ["/repo", ["task-b"]],
      ]);
      expect(survivor.getCurrentResult()).toMatchObject({
        status: "success",
        data: [session("b")],
      });
      expect(harness.records("task-a")).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test("a deletion after a shared read failed reads the other lists again", async () => {
    const readPort = createReadPort(async (repoPath, taskIds) => {
      if (taskIds.includes("task-a")) throw new Error("Task not found: task-a");
      return recordsFrom({ "task-b": [session("b")] })(repoPath, taskIds);
    });
    const harness = createHarness(readPort);
    try {
      const survivor = harness.observe("task-b", null);
      harness.observe("task-a", null);
      await waitForReads(readPort, 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(survivor.getCurrentResult().status).toBe("error");

      await harness.reconcile([event([], ["task-a"])]);

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([
        ["/repo", ["task-a", "task-b"]],
        ["/repo", ["task-b"]],
      ]);
      expect(survivor.getCurrentResult()).toMatchObject({
        status: "success",
        data: [session("b")],
      });
      expect(harness.records("task-a")).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test("refetches observed session lists of an inactive workspace after a stream snapshot", async () => {
    const readPort = createReadPort(recordsFrom({ "observed-task": [session("fresh")] }));
    const harness = createHarness(readPort);
    try {
      harness.observe("observed-task", [], "/other-repo");
      harness.queryClient.setQueryData(agentSessionQueryKeys.list("/other-repo", "unobserved"), [
        session("unobserved"),
      ]);

      await harness.sync.reconcileStreamSnapshot(new Map([["/repo", []]]), () => true);

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([
        ["/other-repo", ["observed-task"]],
      ]);
      expect(harness.records("observed-task", "/other-repo")).toEqual([session("fresh")]);
      expect(harness.records("unobserved", "/other-repo")).toBeUndefined();
    } finally {
      harness.dispose();
    }
  });
});
