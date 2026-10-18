import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  ExternalTaskSyncEvent,
  TaskAgentSessions,
  TaskCard,
  TaskEventCursor,
} from "@openducktor/contracts";
import { notifyManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import type { TaskStreamFrame, TaskStreamSubscription } from "@/lib/shell-bridge";
import {
  type AdmittedSessionChange,
  createAgentSessionViewSync,
  type AgentSessionViewReadPort,
  type AgentSessionViewSync,
} from "@/state/queries/agent-session-view-sync";
import {
  agentSessionListQueryOptions,
  agentSessionQueryKeys,
  loadAgentSessionListFromQuery,
} from "@/state/queries/agent-sessions";
import {
  createTaskViewSync,
  type TaskSnapshotResult,
  type TaskViewSync,
} from "@/state/queries/task-view-sync";
import { taskQueryKeys } from "@/state/queries/tasks";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { createTaskStreamController } from "./task-stream-controller";

const epoch = "11111111-1111-4111-8111-111111111111";
const cursor = (sequence: number): TaskEventCursor => ({ epoch, sequence });
const event = (taskId: string, repoPath = "/repo"): ExternalTaskSyncEvent => ({
  kind: "tasks_updated",
  boardChanges: null,
  eventId: `event-${taskId}`,
  repoPath,
  taskIds: [taskId],
  removedTaskIds: [],
  statusChanges: [],
  taskSnapshots: [{ id: taskId, title: taskId, status: "open" }],
  emittedAt: "2026-04-10T13:10:00.000Z",
});

/** The task IDs that a snapshot read in the test workspace. */
const snapshotOf = (taskIds: string[]): TaskSnapshotResult => ({
  taskIdsByRepo: new Map([["/repo", taskIds]]),
  failures: new Map(),
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

type SubscriptionRecord = {
  acknowledge: ReturnType<typeof mock<(cursor: TaskEventCursor) => Promise<void>>>;
  input: { cursor: TaskEventCursor | null };
  listener: (frame: TaskStreamFrame) => void;
  onTerminalFailure: (cause: unknown) => void;
  unsubscribe: ReturnType<typeof mock<() => Promise<void>>>;
};

/** A session view sync for one open, active workspace. A test replaces what it checks. */
const createSessionSync = (
  queryClient: QueryClient,
  readPort: AgentSessionViewReadPort,
  overrides: Partial<Parameters<typeof createAgentSessionViewSync>[0]> = {},
): AgentSessionViewSync =>
  createAgentSessionViewSync({
    queryClient,
    readPort,
    listSessionTaskIds: () => [],
    removeTaskSessions: () => {},
    refreshLiveSessions: async () => {},
    isWorkspaceOpen: () => true,
    isWorkspaceActive: () => true,
    ...overrides,
  });

const createHarness = ({
  onSubscribe,
  onSnapshotStarted = mock((_repoPath: string) => {}),
  onSnapshotFinished = mock((_repoPath: string, _succeeded: boolean) => {}),
  onWorkspaceFailures = mock((_failures: ReadonlyMap<string, unknown>) => {}),
  taskViewSync: taskViewSyncOverrides,
  agentSessionViewSync: agentSessionViewSyncOverride,
  getOpenRepoPaths = () => ["/repo"],
}: {
  onSubscribe?: (record: SubscriptionRecord, index: number) => Promise<TaskStreamSubscription>;
  onSnapshotStarted?: ReturnType<typeof mock<(repoPath: string) => void>>;
  onSnapshotFinished?: ReturnType<typeof mock<(repoPath: string, succeeded: boolean) => void>>;
  onWorkspaceFailures?: ReturnType<typeof mock<(failures: ReadonlyMap<string, unknown>) => void>>;
  taskViewSync?: Partial<TaskViewSync>;
  agentSessionViewSync?: AgentSessionViewSync;
  getOpenRepoPaths?: () => readonly string[];
} = {}) => {
  const records: SubscriptionRecord[] = [];
  const taskViewSync: TaskViewSync = {
    loadWorkspace: async () => {},
    refreshManually: async () => {},
    refreshAfterTaskRetentionChange: async () => {},
    refreshDocumentsForTasks: async () => {},
    reconcileExternalEvent: mock(async () => {}),
    reconcileStreamSnapshot: mock(
      async (repoPaths: readonly string[]): Promise<TaskSnapshotResult> => ({
        taskIdsByRepo: new Map(repoPaths.map((repoPath) => [repoPath, []])),
        failures: new Map(),
      }),
    ),
    releaseWorkspace: async () => {},
    ...taskViewSyncOverrides,
  };
  const agentSessionViewSync: AgentSessionViewSync = agentSessionViewSyncOverride ?? {
    admitExternalEvent: mock(async (sessionEvent: ExternalTaskSyncEvent) => ({
      repoPath: sessionEvent.repoPath,
      changedTaskIds: [],
    })),
    completeExternalEvents: mock(async (changes: AdmittedSessionChange[]) => {
      await Promise.all(changes);
    }),
    cancelReads: mock(() => {}),
    reconcileStreamSnapshot: mock(async () => new Map<string, unknown>()),
    releaseWorkspace: mock(async (_repoPath: string) => {}),
  };
  const transport = {
    subscribeNotificationStream: async () => () => {},
    subscribeTaskStream: mock(async (input, listener, onTerminalFailure) => {
      const record: SubscriptionRecord = {
        acknowledge: mock(async (_cursor: TaskEventCursor) => {}),
        input,
        listener,
        onTerminalFailure: onTerminalFailure ?? (() => {}),
        unsubscribe: mock(async () => {}),
      };
      records.push(record);
      if (onSubscribe) return onSubscribe(record, records.length - 1);
      return {
        subscriptionId: `subscription-${records.length}`,
        acknowledge: record.acknowledge,
        unsubscribe: record.unsubscribe,
      };
    }),
  };
  const onDegraded = mock((cause: unknown) => {
    void cause;
  });
  const controllerOptions: Parameters<typeof createTaskStreamController>[0] = {
    transport,
    taskViewSync,
    agentSessionViewSync,
    getOpenRepoPaths,
    onDegraded,
    onSnapshotStarted,
    onSnapshotFinished,
    onWorkspaceFailures,
  };
  const controller = createTaskStreamController(controllerOptions);

  return {
    controller,
    agentSessionViewSync,
    onDegraded,
    onSnapshotFinished,
    onSnapshotStarted,
    onWorkspaceFailures,
    records,
    taskViewSync,
    transport,
    emit: (index: number, frame: TaskStreamFrame) => records[index]?.listener(frame),
    failTerminally: (index: number, cause: unknown): void => {
      records[index]?.onTerminalFailure(cause);
    },
  };
};

describe("task stream controller recovery", () => {
  test("claims the open repositories before applying a snapshot", async () => {
    const snapshotRefresh = deferred<void>();
    const harness = createHarness({
      taskViewSync: {
        reconcileStreamSnapshot: async () => {
          await snapshotRefresh.promise;
          return snapshotOf([]);
        },
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
    await flush();

    expect(harness.onSnapshotStarted).toHaveBeenCalledWith("/repo");
    expect(harness.onSnapshotFinished).not.toHaveBeenCalled();
    snapshotRefresh.resolve();
    await flush();

    expect(harness.onSnapshotFinished).toHaveBeenCalledWith("/repo", true);
  });

  test("reconciles every open repository and reports the failures of each", async () => {
    const taskIdsByRepo = new Map([
      ["/repo-a", ["task-a"]],
      ["/repo-c", ["task-c"]],
    ]);
    const harness = createHarness({
      getOpenRepoPaths: () => ["/repo-a", "/repo-b", "/repo-c"],
      taskViewSync: {
        reconcileStreamSnapshot: mock(async () => ({
          taskIdsByRepo,
          failures: new Map([
            ["/repo-a", new Error("spec unavailable")],
            ["/repo-b", new Error("task store unavailable")],
          ]),
        })),
      },
    });
    harness.agentSessionViewSync.reconcileStreamSnapshot = mock(
      async () => new Map([["/repo-c", new Error("live refresh failed")]]),
    );

    await harness.controller.start();
    harness.emit(0, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
    await flush();

    expect(harness.taskViewSync.reconcileStreamSnapshot).toHaveBeenCalledWith([
      "/repo-a",
      "/repo-b",
      "/repo-c",
    ]);
    expect(harness.agentSessionViewSync.reconcileStreamSnapshot).toHaveBeenCalledWith(
      taskIdsByRepo,
      expect.any(Function),
    );
    expect(harness.onSnapshotStarted.mock.calls).toEqual([["/repo-a"], ["/repo-b"], ["/repo-c"]]);
    // The failed task list keeps its workspace owned, so no task load reads it again. A failed
    // document read does not, because the task list of its workspace is current.
    expect(harness.onSnapshotFinished.mock.calls).toEqual([
      ["/repo-a", true],
      ["/repo-b", false],
      ["/repo-c", true],
    ]);
    expect(harness.onWorkspaceFailures.mock.calls).toEqual([
      [
        new Map([
          ["/repo-a", new Error("spec unavailable")],
          ["/repo-b", new Error("task store unavailable")],
          ["/repo-c", new Error("live refresh failed")],
        ]),
      ],
    ]);
    // The stream itself is not degraded.
    expect(harness.onDegraded).not.toHaveBeenCalled();
    // The stream stays open for every workspace.
    expect(harness.records[0]?.acknowledge).toHaveBeenCalledWith(cursor(7));
    expect(harness.records).toHaveLength(1);
  });

  test("reports only the repositories that stay open during a snapshot", async () => {
    let openRepoPaths = ["/repo-a", "/repo-b"];
    const harness = createHarness({
      getOpenRepoPaths: () => openRepoPaths,
      taskViewSync: {
        reconcileStreamSnapshot: mock(async () => {
          openRepoPaths = ["/repo-a"];
          return {
            taskIdsByRepo: new Map([
              ["/repo-a", ["task-a"]],
              ["/repo-b", ["task-b"]],
            ]),
            failures: new Map(),
          };
        }),
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
    await flush();

    expect(harness.onSnapshotFinished.mock.calls).toEqual([["/repo-a", true]]);
    expect(harness.records[0]?.acknowledge).toHaveBeenCalledWith(cursor(7));
  });

  test("acknowledges a snapshot without waiting for the read of a workspace that closed", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const pendingRead = deferred<TaskCard[]>();
    const readStarted = deferred<void>();
    const taskViewSync = createTaskViewSync({
      queryClient,
      ports: {
        listTasks: async (repoPath) => {
          if (repoPath === "/repo-a") return [createTaskCardFixture({ id: "task-a" })];
          readStarted.resolve();
          return pendingRead.promise;
        },
        loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
      },
    });
    let openRepoPaths = ["/repo-a", "/repo-b"];
    const harness = createHarness({ getOpenRepoPaths: () => openRepoPaths, taskViewSync });

    try {
      await harness.controller.start();
      harness.emit(0, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
      await readStarted.promise;
      openRepoPaths = ["/repo-a"];
      await harness.controller.releaseWorkspace("/repo-b");
      await flush();

      expect(harness.records[0]?.acknowledge).toHaveBeenCalledWith(cursor(7));
      expect(harness.onDegraded).not.toHaveBeenCalled();
      expect(harness.onWorkspaceFailures).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo-b"))).toBeUndefined();
    } finally {
      pendingRead.resolve([]);
      queryClient.clear();
    }
  });

  test("uses one task list read to reconcile task and session snapshots", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const listTasks = mock(async () => [createTaskCardFixture({ id: "task-1" })]);
    const taskViewSync = createTaskViewSync({
      queryClient,
      ports: {
        listTasks,
        loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
      },
    });
    const loadSessionBatch = mock(async () => [{ taskId: "task-1", agentSessions: [] }]);
    const agentSessionViewSync = createSessionSync(queryClient, {
      agentSessionsListForTasks: loadSessionBatch,
      taskIdsList: async () => ["task-1"],
    });
    const harness = createHarness({ taskViewSync, agentSessionViewSync });

    await harness.controller.start();
    harness.emit(0, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
    await flush();

    expect(listTasks).toHaveBeenCalledTimes(1);
    expect(loadSessionBatch).toHaveBeenCalledWith("/repo", ["task-1"]);
  });

  test("applies task and session views before acknowledging a change", async () => {
    const sessionRefresh = deferred<void>();
    const harness = createHarness();
    harness.agentSessionViewSync.completeExternalEvents = mock(async () => sessionRefresh.promise);

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("task-1") });
    await flush();

    expect(harness.taskViewSync.reconcileExternalEvent).toHaveBeenCalledTimes(1);
    expect(harness.records[0]?.acknowledge).not.toHaveBeenCalled();

    sessionRefresh.resolve();
    await flush();

    expect(harness.records[0]?.acknowledge).toHaveBeenCalledWith(cursor(0));
  });

  test("changes that arrive together share one session reconciliation", async () => {
    const harness = createHarness();

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    harness.emit(0, { type: "change", cursor: cursor(1), event: event("one") });
    await flush();

    expect(harness.agentSessionViewSync.admitExternalEvent).toHaveBeenCalledTimes(2);
    expect(harness.agentSessionViewSync.completeExternalEvents).toHaveBeenCalledTimes(1);
    expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(1)]]);
  });

  test("a replacement snapshot cancels the record reads of the replaced stream", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const listKey = agentSessionQueryKeys.list("/repo", "task-1");
    const olderRead = deferred<TaskAgentSessions[]>();
    const snapshotPrepared = deferred<string[]>();
    const loadSessionBatch = mock(async (_repoPath: string, taskIds: string[]) =>
      loadSessionBatch.mock.calls.length === 1
        ? olderRead.promise
        : taskIds.map((taskId) => ({ taskId, agentSessions: [] })),
    );
    const refreshLiveSessions = mock(async (_repoPath: string) => {});
    const readPort = { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] };
    const harness = createHarness({
      taskViewSync: { reconcileStreamSnapshot: () => snapshotPrepared.promise.then(snapshotOf) },
      agentSessionViewSync: createSessionSync(queryClient, readPort, { refreshLiveSessions }),
    });
    queryClient.setQueryData(listKey, []);
    const stopObserving = new QueryObserver(
      queryClient,
      agentSessionListQueryOptions("/repo", "task-1", readPort),
    ).subscribe(() => {});
    try {
      await harness.controller.start();
      harness.emit(0, { type: "change", cursor: cursor(0), event: event("task-1") });
      await flush();
      expect(loadSessionBatch).toHaveBeenCalledTimes(1);

      harness.emit(0, { type: "snapshot_required", cursor: cursor(5), reason: "buffer_gap" });
      olderRead.resolve([
        {
          taskId: "task-1",
          agentSessions: [
            {
              externalSessionId: "superseded-old",
              role: "build",
              runtimeKind: "opencode",
              workingDirectory: "/repo",
              startedAt: "2026-04-10T13:10:00.000Z",
              selectedModel: null,
            },
          ],
        },
      ]);
      await flush();

      expect(queryClient.getQueryData<unknown[]>(listKey)).toEqual([]);
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
      expect(refreshLiveSessions).not.toHaveBeenCalled();

      snapshotPrepared.resolve(["task-1"]);
      await flush();

      expect(loadSessionBatch.mock.calls[1]).toEqual(["/repo", ["task-1"]]);
      expect(refreshLiveSessions).toHaveBeenCalledTimes(1);
      expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(5)]]);
    } finally {
      stopObserving();
      queryClient.clear();
    }
  });

  test("changes that arrive while a request is in progress share the next request", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const busyRead = deferred<TaskAgentSessions[]>();
    const loadSessionBatch = mock(async (_repoPath: string, taskIds: string[]) =>
      taskIds.includes("busy")
        ? busyRead.promise
        : taskIds.map((taskId) => ({ taskId, agentSessions: [] })),
    );
    const readPort = { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] };
    const harness = createHarness({
      agentSessionViewSync: createSessionSync(queryClient, readPort),
    });
    const stops = ["busy", "task-a", "task-b"].map((taskId) => {
      if (taskId !== "busy")
        queryClient.setQueryData(agentSessionQueryKeys.list("/repo", taskId), []);
      return new QueryObserver(
        queryClient,
        agentSessionListQueryOptions("/repo", taskId, readPort),
      ).subscribe(() => {});
    });
    try {
      await harness.controller.start();
      await flush();
      expect(loadSessionBatch.mock.calls).toEqual([["/repo", ["busy"]]]);

      harness.emit(0, { type: "change", cursor: cursor(0), event: event("task-a") });
      await flush();
      harness.emit(0, { type: "change", cursor: cursor(1), event: event("task-b") });
      await flush();
      busyRead.resolve([{ taskId: "busy", agentSessions: [] }]);
      await flush();

      expect(loadSessionBatch.mock.calls).toEqual([
        ["/repo", ["busy"]],
        ["/repo", ["task-a", "task-b"]],
      ]);
      expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(0)], [cursor(1)]]);
    } finally {
      for (const stop of stops) stop();
      queryClient.clear();
    }
  });

  test("a newer snapshot supersedes an older snapshot during task preparation", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const olderPreparation = deferred<string[]>();
    const loadSessionBatch = mock(async (_repoPath: string, taskIds: string[]) =>
      taskIds.map((taskId) => ({ taskId, agentSessions: [] })),
    );
    const refreshLiveSessions = mock(async (_repoPath: string) => {});
    const prepareSnapshot = mock(async (_repoPaths: readonly string[]) =>
      snapshotOf(
        prepareSnapshot.mock.calls.length === 1 ? await olderPreparation.promise : ["newer"],
      ),
    );
    const harness = createHarness({
      taskViewSync: { reconcileStreamSnapshot: prepareSnapshot },
      agentSessionViewSync: createSessionSync(
        queryClient,
        { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] },
        { refreshLiveSessions },
      ),
    });
    try {
      await harness.controller.start();
      harness.emit(0, { type: "snapshot_required", cursor: cursor(5), reason: "buffer_gap" });
      await flush();
      harness.emit(0, { type: "snapshot_required", cursor: cursor(9), reason: "buffer_gap" });
      olderPreparation.resolve(["older"]);
      await flush();

      expect(loadSessionBatch.mock.calls).toEqual([["/repo", ["newer"]]]);
      expect(refreshLiveSessions).toHaveBeenCalledTimes(1);
      expect(harness.onSnapshotFinished.mock.calls).toEqual([["/repo", true]]);
      expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(9)]]);
    } finally {
      queryClient.clear();
    }
  });

  const recordFixture = (externalSessionId: string): AgentSessionRecord => ({
    externalSessionId,
    role: "build",
    runtimeKind: "opencode",
    workingDirectory: "/repo",
    startedAt: "2026-04-10T13:10:00.000Z",
    selectedModel: null,
  });

  test("a change batch starts no live refresh for a workspace that closed while it waited", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const pendingRead = deferred<TaskAgentSessions[]>();
    const readPort = {
      agentSessionsListForTasks: mock(async (repoPath: string, taskIds: string[]) =>
        repoPath === "/repo-a"
          ? pendingRead.promise
          : taskIds.map((taskId) => ({ taskId, agentSessions: [recordFixture("b-new")] })),
      ),
      taskIdsList: async () => [],
    };
    const refreshLiveSessions = mock(async (_repoPath: string) => {});
    let openRepoPaths = ["/repo-a", "/repo-b"];
    const harness = createHarness({
      getOpenRepoPaths: () => openRepoPaths,
      agentSessionViewSync: createSessionSync(queryClient, readPort, {
        refreshLiveSessions,
        isWorkspaceOpen: (repoPath) => openRepoPaths.includes(repoPath),
      }),
    });
    const stopObserving = (
      [
        ["/repo-a", "task-a", "a-old"],
        ["/repo-b", "task-b", "b-old"],
      ] as const
    ).map(([repoPath, taskId, record]) => {
      queryClient.setQueryData(agentSessionQueryKeys.list(repoPath, taskId), [
        recordFixture(record),
      ]);
      return new QueryObserver(
        queryClient,
        agentSessionListQueryOptions(repoPath, taskId, readPort),
      ).subscribe(() => {});
    });

    try {
      await harness.controller.start();
      harness.emit(0, { type: "change", cursor: cursor(0), event: event("task-a", "/repo-a") });
      harness.emit(0, { type: "change", cursor: cursor(1), event: event("task-b", "/repo-b") });
      await flush();
      openRepoPaths = ["/repo-a"];
      await harness.controller.releaseWorkspace("/repo-b");
      pendingRead.resolve([{ taskId: "task-a", agentSessions: [recordFixture("a-new")] }]);
      await flush();

      expect(refreshLiveSessions.mock.calls).toEqual([["/repo-a"]]);
      expect(harness.records[0]?.acknowledge).toHaveBeenCalledWith(cursor(1));
      expect(harness.onDegraded).not.toHaveBeenCalled();
    } finally {
      for (const stop of stopObserving) stop();
      pendingRead.resolve([]);
      queryClient.clear();
    }
  });

  for (let microtasks = 0; microtasks <= 6; microtasks += 1) {
    test(`a snapshot ${microtasks} microtasks after a cold read response keeps its records out`, async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const listKey = agentSessionQueryKeys.list("/repo", "task-1");
      const olderRead = deferred<TaskAgentSessions[]>();
      const snapshotPrepared = deferred<string[]>();
      const loadSessionBatch = mock(async (_repoPath: string, taskIds: string[]) =>
        loadSessionBatch.mock.calls.length === 1
          ? olderRead.promise
          : taskIds.map((taskId) => ({ taskId, agentSessions: [] })),
      );
      const readPort = { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] };
      const harness = createHarness({
        taskViewSync: { reconcileStreamSnapshot: () => snapshotPrepared.promise.then(snapshotOf) },
        agentSessionViewSync: createSessionSync(queryClient, readPort),
      });
      const observer = new QueryObserver(
        queryClient,
        agentSessionListQueryOptions("/repo", "task-1", readPort),
      );
      let snapshotArrived = false;
      const lateRecords: string[] = [];
      // A view reads observer results like useQuery does. None can carry the superseded records.
      const stopObserving = observer.subscribe(
        notifyManager.batchCalls(() => {
          const data = observer.getCurrentResult().data;
          if (snapshotArrived && data?.[0]) lateRecords.push(data[0].externalSessionId);
        }),
      );
      try {
        await harness.controller.start();
        await flush();
        expect(loadSessionBatch).toHaveBeenCalledTimes(1);
        olderRead.resolve([{ taskId: "task-1", agentSessions: [recordFixture("superseded-old")] }]);
        for (let tick = 0; tick < microtasks; tick += 1) await Promise.resolve();
        const coldAtArrival = queryClient.getQueryData(listKey) === undefined;
        snapshotArrived = true;
        harness.emit(0, { type: "snapshot_required", cursor: cursor(5), reason: "buffer_gap" });
        await flush();

        if (coldAtArrival) {
          expect(lateRecords).toEqual([]);
          expect(queryClient.getQueryData(listKey)).toBeUndefined();
        }

        snapshotPrepared.resolve(["task-1"]);
        await flush();

        expect(observer.getCurrentResult()).toMatchObject({ status: "success", data: [] });
        expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(5)]]);
      } finally {
        stopObserving();
        queryClient.clear();
      }
    });
  }

  for (let microtasks = 0; microtasks <= 6; microtasks += 1) {
    test(`a change ${microtasks} microtasks after an unobserved response waits for current records`, async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const olderRead = deferred<TaskAgentSessions[]>();
      const currentRead = deferred<TaskAgentSessions[]>();
      const loadSessionBatch = mock(async (_repoPath: string, _taskIds: string[]) =>
        loadSessionBatch.mock.calls.length === 1 ? olderRead.promise : currentRead.promise,
      );
      const readPort = { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] };
      const harness = createHarness({
        agentSessionViewSync: createSessionSync(queryClient, readPort),
      });
      try {
        await harness.controller.start();
        const loading = loadAgentSessionListFromQuery(queryClient, "/repo", "task-1", { readPort });
        await flush();
        olderRead.resolve([{ taskId: "task-1", agentSessions: [recordFixture("old")] }]);
        for (let tick = 0; tick < microtasks; tick += 1) await Promise.resolve();
        harness.emit(0, { type: "change", cursor: cursor(0), event: event("task-1") });
        await flush();

        // A second read means that a pending read needs current records. The change waits too.
        if (loadSessionBatch.mock.calls.length === 2) {
          expect(harness.records[0]?.acknowledge).not.toHaveBeenCalled();
          currentRead.resolve([{ taskId: "task-1", agentSessions: [recordFixture("current")] }]);
          expect(await loading).toEqual([recordFixture("current")]);
          await flush();
        }
        expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(0)]]);
        expect(harness.onDegraded).not.toHaveBeenCalled();
      } finally {
        queryClient.clear();
      }
    });
  }

  test("a confirmed deletion completes a pending unobserved load and its change", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const heldRead = deferred<TaskAgentSessions[]>();
    const loadSessionBatch = mock(async () => heldRead.promise);
    const readPort = { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] };
    const harness = createHarness({
      agentSessionViewSync: createSessionSync(queryClient, readPort),
    });
    try {
      await harness.controller.start();
      const loading = loadAgentSessionListFromQuery(queryClient, "/repo", "task-1", { readPort });
      await flush();
      harness.emit(0, { type: "change", cursor: cursor(0), event: event("task-1") });
      harness.emit(0, {
        type: "change",
        cursor: cursor(1),
        event: {
          kind: "tasks_updated",
          boardChanges: null,
          eventId: "event-delete",
          repoPath: "/repo",
          taskIds: ["task-1"],
          removedTaskIds: ["task-1"],
          statusChanges: [],
          taskSnapshots: [],
          emittedAt: "2026-04-10T13:11:00.000Z",
        },
      });
      await flush();
      heldRead.resolve([{ taskId: "task-1", agentSessions: [recordFixture("deleted")] }]);
      await flush();

      expect(await loading).toEqual([]);
      expect(harness.onDegraded).not.toHaveBeenCalled();
      expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(1)]]);
      expect(loadSessionBatch).toHaveBeenCalledTimes(1);
    } finally {
      queryClient.clear();
    }
  });

  test("changes whose records share a request share one live refresh across drains", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const busyRead = deferred<TaskAgentSessions[]>();
    const loadSessionBatch = mock(async (_repoPath: string, taskIds: string[]) =>
      taskIds.includes("unrelated")
        ? busyRead.promise
        : taskIds.map((taskId) => ({ taskId, agentSessions: [recordFixture(taskId)] })),
    );
    const refreshLiveSessions = mock(async (_repoPath: string) => {});
    const readPort = { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] };
    const harness = createHarness({
      agentSessionViewSync: createSessionSync(queryClient, readPort, { refreshLiveSessions }),
    });
    const stops = ["unrelated", "task-a", "task-b"].map((taskId) => {
      if (taskId !== "unrelated") {
        queryClient.setQueryData(agentSessionQueryKeys.list("/repo", taskId), []);
      }
      return new QueryObserver(
        queryClient,
        agentSessionListQueryOptions("/repo", taskId, readPort),
      ).subscribe(() => {});
    });
    try {
      await harness.controller.start();
      await flush();
      harness.emit(0, { type: "change", cursor: cursor(0), event: event("task-a") });
      await flush();
      harness.emit(0, { type: "change", cursor: cursor(1), event: event("task-b") });
      await flush();
      busyRead.resolve([{ taskId: "unrelated", agentSessions: [] }]);
      await flush();

      expect(loadSessionBatch.mock.calls).toEqual([
        ["/repo", ["unrelated"]],
        ["/repo", ["task-a", "task-b"]],
      ]);
      expect(refreshLiveSessions.mock.calls).toEqual([["/repo"]]);
      expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(0)], [cursor(1)]]);
    } finally {
      for (const stop of stops) stop();
      queryClient.clear();
    }
  });

  test("a stopped stream starts no live refresh for its snapshot", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const heldRead = deferred<TaskAgentSessions[]>();
    const loadSessionBatch = mock(async () => heldRead.promise);
    const refreshLiveSessions = mock(async (_repoPath: string) => {});
    const harness = createHarness({
      taskViewSync: { reconcileStreamSnapshot: async () => snapshotOf(["task-1"]) },
      agentSessionViewSync: createSessionSync(
        queryClient,
        { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] },
        { refreshLiveSessions },
      ),
    });
    try {
      await harness.controller.start();
      harness.emit(0, { type: "snapshot_required", cursor: cursor(5), reason: "buffer_gap" });
      await flush();
      expect(loadSessionBatch).toHaveBeenCalledTimes(1);

      await harness.controller.stop();
      heldRead.resolve([{ taskId: "task-1", agentSessions: [recordFixture("current")] }]);
      await flush();

      expect(refreshLiveSessions).not.toHaveBeenCalled();
      expect(harness.onSnapshotFinished).not.toHaveBeenCalled();
      expect(harness.records[0]?.acknowledge).not.toHaveBeenCalled();
    } finally {
      queryClient.clear();
    }
  });

  for (let microtasks = 0; microtasks <= 6; microtasks += 1) {
    test(`a snapshot ${microtasks} microtasks after a record response keeps a list from a read`, async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const listKey = agentSessionQueryKeys.list("/repo", "task-1");
      const olderRead = deferred<TaskAgentSessions[]>();
      const snapshotPrepared = deferred<string[]>();
      const loadSessionBatch = mock(async (_repoPath: string, taskIds: string[]) =>
        loadSessionBatch.mock.calls.length === 2
          ? olderRead.promise
          : taskIds.map((taskId) => ({ taskId, agentSessions: [recordFixture("loaded")] })),
      );
      const readPort = { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] };
      const harness = createHarness({
        taskViewSync: { reconcileStreamSnapshot: () => snapshotPrepared.promise.then(snapshotOf) },
        agentSessionViewSync: createSessionSync(queryClient, readPort),
      });
      const observer = new QueryObserver(
        queryClient,
        agentSessionListQueryOptions("/repo", "task-1", readPort),
      );
      const stopObserving = observer.subscribe(() => {});
      try {
        await harness.controller.start();
        await flush();
        expect(observer.getCurrentResult().data).toEqual([recordFixture("loaded")]);
        harness.emit(0, { type: "change", cursor: cursor(0), event: event("task-1") });
        await flush();
        expect(loadSessionBatch).toHaveBeenCalledTimes(2);
        olderRead.resolve([{ taskId: "task-1", agentSessions: [recordFixture("superseded-old")] }]);
        for (let tick = 0; tick < microtasks; tick += 1) await Promise.resolve();
        harness.emit(0, { type: "snapshot_required", cursor: cursor(5), reason: "buffer_gap" });
        await flush();

        // The list that the earlier read loaded stays, unless the newer read stored before.
        expect(queryClient.getQueryState(listKey)?.status).toBe("success");
        expect(queryClient.getQueryData(listKey)).toBeDefined();

        snapshotPrepared.resolve(["task-1"]);
        await flush();

        expect(observer.getCurrentResult()).toMatchObject({
          status: "success",
          data: [recordFixture("loaded")],
        });
      } finally {
        stopObserving();
        queryClient.clear();
      }
    });
  }

  test("a stopped stream starts no live refresh for its pending changes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const listKey = agentSessionQueryKeys.list("/repo", "task-1");
    const heldRead = deferred<TaskAgentSessions[]>();
    const loadSessionBatch = mock(async () => heldRead.promise);
    const refreshLiveSessions = mock(async (_repoPath: string) => {});
    const readPort = { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] };
    const harness = createHarness({
      agentSessionViewSync: createSessionSync(queryClient, readPort, { refreshLiveSessions }),
    });
    queryClient.setQueryData(listKey, []);
    const stopObserving = new QueryObserver(
      queryClient,
      agentSessionListQueryOptions("/repo", "task-1", readPort),
    ).subscribe(() => {});
    try {
      await harness.controller.start();
      harness.emit(0, { type: "change", cursor: cursor(0), event: event("task-1") });
      await flush();
      expect(loadSessionBatch).toHaveBeenCalledTimes(1);

      await harness.controller.stop();
      heldRead.resolve([{ taskId: "task-1", agentSessions: [recordFixture("new-session")] }]);
      await flush();

      // The shared record read still serves its view. The stopped stream does no more work.
      expect(queryClient.getQueryData<AgentSessionRecord[]>(listKey)).toEqual([
        recordFixture("new-session"),
      ]);
      expect(refreshLiveSessions).not.toHaveBeenCalled();
      expect(harness.records[0]?.acknowledge).not.toHaveBeenCalled();
    } finally {
      stopObserving();
      queryClient.clear();
    }
  });

  for (let microtasks = 0; microtasks <= 6; microtasks += 1) {
    test(`a snapshot ${microtasks} microtasks after a record response stops the older change`, async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const listKey = agentSessionQueryKeys.list("/repo", "task-1");
      const olderRead = deferred<TaskAgentSessions[]>();
      const snapshotPrepared = deferred<string[]>();
      const loadSessionBatch = mock(async (_repoPath: string, taskIds: string[]) =>
        loadSessionBatch.mock.calls.length === 1
          ? olderRead.promise
          : taskIds.map((taskId) => ({ taskId, agentSessions: [] })),
      );
      let snapshotArrived = false;
      const lateWork: string[] = [];
      const refreshLiveSessions = mock(async (_repoPath: string) => {
        if (snapshotArrived) lateWork.push("live refresh");
      });
      const readPort = { agentSessionsListForTasks: loadSessionBatch, taskIdsList: async () => [] };
      const harness = createHarness({
        taskViewSync: { reconcileStreamSnapshot: () => snapshotPrepared.promise.then(snapshotOf) },
        agentSessionViewSync: createSessionSync(queryClient, readPort, { refreshLiveSessions }),
      });
      queryClient.setQueryData(listKey, []);
      const stopObserving = new QueryObserver(
        queryClient,
        agentSessionListQueryOptions("/repo", "task-1", readPort),
      ).subscribe(() => {});
      const stopWatching = queryClient.getQueryCache().subscribe(() => {
        const data = queryClient.getQueryData<AgentSessionRecord[]>(listKey);
        if (snapshotArrived && data?.[0]?.externalSessionId === "superseded-old") {
          lateWork.push("older records");
        }
      });
      try {
        await harness.controller.start();
        harness.emit(0, { type: "change", cursor: cursor(0), event: event("task-1") });
        await flush();
        olderRead.resolve([
          {
            taskId: "task-1",
            agentSessions: [
              {
                externalSessionId: "superseded-old",
                role: "build",
                runtimeKind: "opencode",
                workingDirectory: "/repo",
                startedAt: "2026-04-10T13:10:00.000Z",
                selectedModel: null,
              },
            ],
          },
        ]);
        for (let tick = 0; tick < microtasks; tick += 1) await Promise.resolve();
        snapshotArrived = true;
        harness.emit(0, { type: "snapshot_required", cursor: cursor(5), reason: "buffer_gap" });
        await flush();

        expect(lateWork).toEqual([]);

        snapshotPrepared.resolve(["task-1"]);
        await flush();

        expect(refreshLiveSessions).toHaveBeenCalled();
        expect(harness.records[0]?.acknowledge.mock.calls.at(-1)).toEqual([cursor(5)]);
      } finally {
        stopWatching();
        stopObserving();
        queryClient.clear();
      }
    });
  }

  test("changes received during a reconciliation share one session reconciliation", async () => {
    const firstRefresh = deferred<void>();
    const harness = createHarness();
    const completeSessions = mock(async (changes: AdmittedSessionChange[]) => {
      await Promise.all(changes);
      if (completeSessions.mock.calls.length === 1) await firstRefresh.promise;
    });
    harness.agentSessionViewSync.completeExternalEvents = completeSessions;

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    for (const [sequence, taskId] of [
      [1, "one"],
      [2, "two"],
      [3, "three"],
    ] as const) {
      harness.emit(0, { type: "change", cursor: cursor(sequence), event: event(taskId) });
    }
    await flush();
    expect(harness.records[0]?.acknowledge).not.toHaveBeenCalled();

    firstRefresh.resolve();
    await flush();

    expect(completeSessions.mock.calls.map(([changes]) => changes.length)).toEqual([1, 3]);
    expect(harness.agentSessionViewSync.admitExternalEvent).toHaveBeenCalledTimes(4);
    expect(harness.taskViewSync.reconcileExternalEvent).toHaveBeenCalledTimes(4);
    expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(0)], [cursor(3)]]);
  });

  test("an acknowledgement failure inside a run recovers without reapplying the run", async () => {
    const firstRefresh = deferred<void>();
    const harness = createHarness({
      onSubscribe: async (record, index) => {
        if (index === 0) {
          record.acknowledge.mockImplementation(async (nextCursor) => {
            if (nextCursor.sequence === 2) throw new Error("ack unavailable");
          });
        }
        return {
          subscriptionId: `subscription-${index}`,
          acknowledge: record.acknowledge,
          unsubscribe: record.unsubscribe,
        };
      },
    });
    const completeSessions = mock(async (changes: AdmittedSessionChange[]) => {
      await Promise.all(changes);
      if (completeSessions.mock.calls.length === 1) await firstRefresh.promise;
    });
    harness.agentSessionViewSync.completeExternalEvents = completeSessions;

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.emit(0, { type: "change", cursor: cursor(1), event: event("one") });
    harness.emit(0, { type: "change", cursor: cursor(2), event: event("two") });
    firstRefresh.resolve();
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[1]?.input).toEqual({ cursor: cursor(0) });

    harness.emit(1, { type: "change", cursor: cursor(1), event: event("one") });
    harness.emit(1, { type: "change", cursor: cursor(2), event: event("two") });
    await flush();

    expect(completeSessions).toHaveBeenCalledTimes(2);
    expect(harness.agentSessionViewSync.admitExternalEvent).toHaveBeenCalledTimes(3);
    expect(harness.taskViewSync.reconcileExternalEvent).toHaveBeenCalledTimes(3);
    expect(harness.records[1]?.acknowledge.mock.calls).toEqual([[cursor(2)]]);
  });

  test("applies a burst while one acknowledgement is held and coalesces its progress", async () => {
    const heldAck = deferred<void>();
    const harness = createHarness({
      onSubscribe: async (record, index) => {
        record.acknowledge.mockImplementation(async (next) => {
          if (next.sequence === 0) await heldAck.promise;
        });
        return {
          subscriptionId: `subscription-${index}`,
          acknowledge: record.acknowledge,
          unsubscribe: record.unsubscribe,
        };
      },
    });
    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    for (let sequence = 1; sequence <= 20; sequence++) {
      harness.emit(0, { type: "change", cursor: cursor(sequence), event: event(String(sequence)) });
    }
    await flush();
    expect(harness.taskViewSync.reconcileExternalEvent).toHaveBeenCalledTimes(21);
    expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(0)]]);
    heldAck.resolve();
    await flush();
    expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(0)], [cursor(20)]]);
    expect(harness.onDegraded).not.toHaveBeenCalled();
    await harness.controller.stop();
  });

  test("application failure closes the subscription, recovers from a snapshot, and resumes", async () => {
    const applicationFailure = new Error("upper failed");
    let applications = 0;
    const harness = createHarness({
      taskViewSync: {
        reconcileExternalEvent: mock(async () => {
          applications += 1;
          if (applications === 1) throw applicationFailure;
        }),
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("failed") });
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.records[1]?.input).toEqual({ cursor: null });
    expect(harness.onDegraded).toHaveBeenCalledWith(applicationFailure);

    harness.emit(1, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
    await flush();
    harness.emit(1, { type: "change", cursor: cursor(8), event: event("resumed") });
    await flush();

    expect(harness.taskViewSync.reconcileStreamSnapshot).toHaveBeenCalledWith(["/repo"]);
    expect(harness.agentSessionViewSync.reconcileStreamSnapshot).toHaveBeenCalledWith(
      new Map([["/repo", []]]),
      expect.any(Function),
    );
    expect(harness.records[1]?.acknowledge.mock.calls).toEqual([[cursor(7)], [cursor(8)]]);
    expect(applications).toBe(2);
  });

  test("ambiguous ACK failure recovers from the last acknowledged cursor without reapplying", async () => {
    const harness = createHarness({
      onSubscribe: async (record, index) => {
        if (index === 0) {
          record.acknowledge.mockImplementation(async (nextCursor) => {
            if (nextCursor.sequence === 1) throw new Error("ack unavailable");
          });
        }
        return {
          subscriptionId: `subscription-${index}`,
          acknowledge: record.acknowledge,
          unsubscribe: record.unsubscribe,
        };
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.emit(0, { type: "change", cursor: cursor(1), event: event("one") });
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.records[1]?.input).toEqual({ cursor: cursor(0) });
    expect(harness.records[1]?.acknowledge).not.toHaveBeenCalled();

    harness.emit(1, { type: "change", cursor: cursor(1), event: event("one") });
    await flush();
    harness.emit(1, { type: "change", cursor: cursor(2), event: event("two") });
    await flush();

    expect(harness.taskViewSync.reconcileExternalEvent).toHaveBeenCalledTimes(3);
    expect(harness.records[1]?.acknowledge.mock.calls).toEqual([[cursor(1)], [cursor(2)]]);
  });

  test("a recovery subscription failure remains degraded without a second attempt", async () => {
    const recoveryFailure = new Error("recovery unavailable");
    const applicationFailure = new Error("application failed");
    const harness = createHarness({
      onSubscribe: async (record, index) => {
        if (index === 1) throw recoveryFailure;
        return {
          subscriptionId: "initial",
          acknowledge: record.acknowledge,
          unsubscribe: record.unsubscribe,
        };
      },
      taskViewSync: {
        reconcileExternalEvent: async () => {
          throw applicationFailure;
        },
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("failed") });
    await flush();
    await flush();

    expect(harness.transport.subscribeTaskStream).toHaveBeenCalledTimes(2);
    expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.onDegraded).toHaveBeenCalledTimes(1);
    expect(harness.onDegraded).toHaveBeenCalledWith(applicationFailure);
  });

  test("rejects an initial subscription failure and lets stop complete", async () => {
    const subscribeFailure = new Error("stream unavailable");
    const harness = createHarness({
      onSubscribe: async () => {
        throw subscribeFailure;
      },
    });

    const firstStart = harness.controller.start();
    const secondStart = harness.controller.start();

    expect(secondStart).toBe(firstStart);
    await expect(firstStart).rejects.toBe(subscribeFailure);
    await expect(harness.controller.start()).rejects.toBe(subscribeFailure);
    await expect(harness.controller.stop()).resolves.toBeUndefined();
  });

  test("recovers one terminal stream failure from the last acknowledged cursor", async () => {
    const terminalFailure = new Error("stream ended");
    const secondTerminalFailure = new Error("stream ended again");
    const harness = createHarness();

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.failTerminally(0, terminalFailure);
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[1]?.input).toEqual({ cursor: cursor(0) });
    expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);

    harness.failTerminally(1, secondTerminalFailure);
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[1]?.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("keeps a terminal recovery acquisition failure in the degraded episode", async () => {
    const terminalFailure = new Error("stream ended");
    const recoveryFailure = new Error("replacement unavailable");
    const harness = createHarness({
      onSubscribe: async (record, index) => {
        if (index === 1) throw recoveryFailure;
        return {
          subscriptionId: "initial",
          acknowledge: record.acknowledge,
          unsubscribe: record.unsubscribe,
        };
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.failTerminally(0, terminalFailure);
    await flush();
    await flush();

    expect(harness.transport.subscribeTaskStream).toHaveBeenCalledTimes(2);
    expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.onDegraded).toHaveBeenCalledWith(terminalFailure);
  });

  test("drains a replay delivered before the replacement terminal subscription resolves", async () => {
    const harness = createHarness({
      onSubscribe: async (record, index) => {
        if (index === 1) {
          record.listener({ type: "change", cursor: cursor(1), event: event("replayed") });
        }
        return {
          subscriptionId: `subscription-${index}`,
          acknowledge: record.acknowledge,
          unsubscribe: record.unsubscribe,
        };
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.failTerminally(0, new Error("stream ended"));
    await flush();

    expect(harness.taskViewSync.reconcileExternalEvent).toHaveBeenCalledTimes(2);
    expect(harness.records[1]?.acknowledge).toHaveBeenCalledWith(cursor(1));
  });

  test("ignores terminal failures from an obsolete subscription", async () => {
    const harness = createHarness();

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.failTerminally(0, new Error("stream ended"));
    await flush();
    harness.failTerminally(0, new Error("obsolete stream ended"));
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[1]?.input).toEqual({ cursor: cursor(0) });
  });

  test("does not acknowledge a snapshot until its refresh completes", async () => {
    const snapshotRefresh = deferred<void>();
    const harness = createHarness({
      taskViewSync: {
        reconcileStreamSnapshot: async () => {
          await snapshotRefresh.promise;
          return snapshotOf([]);
        },
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
    await flush();

    expect(harness.records[0]?.acknowledge).not.toHaveBeenCalled();
    snapshotRefresh.resolve();
    await flush();

    expect(harness.records[0]?.acknowledge).toHaveBeenCalledWith(cursor(7));
  });

  test("a recovery snapshot application failure closes the recovery stream without looping", async () => {
    const snapshotFailure = new Error("snapshot failed");
    const changeFailure = new Error("change failed");
    let changeApplications = 0;
    const harness = createHarness({
      taskViewSync: {
        reconcileExternalEvent: async () => {
          changeApplications += 1;
          if (changeApplications === 1) throw changeFailure;
        },
        reconcileStreamSnapshot: async () => {
          throw snapshotFailure;
        },
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("failed") });
    await flush();
    harness.emit(1, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
    await flush();
    await flush();

    expect(harness.transport.subscribeTaskStream).toHaveBeenCalledTimes(2);
    expect(harness.records[1]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.onDegraded).toHaveBeenCalledWith(changeFailure);
    expect(harness.onSnapshotFinished).toHaveBeenCalledWith("/repo", false);
  });

  test.each(["acquisition", "acknowledgement-success", "acknowledgement-failure"] as const)(
    "concurrent starts share acquisition and stop waits for teardown during %s",
    async (pending) => {
      const acquired = deferred<void>();
      const acknowledgement = deferred<void>();
      const teardown = deferred<void>();
      const harness = createHarness({
        onSubscribe: async (record) => {
          record.acknowledge.mockImplementation(async () => acknowledgement.promise);
          record.unsubscribe.mockImplementation(async () => teardown.promise);
          await acquired.promise;
          return {
            subscriptionId: "pending",
            acknowledge: record.acknowledge,
            unsubscribe: record.unsubscribe,
          };
        },
      });
      const firstStart = harness.controller.start();
      const secondStart = harness.controller.start();
      let stop: Promise<void> | undefined;
      try {
        if (pending !== "acquisition") {
          acquired.resolve();
          await firstStart;
          harness.emit(0, { type: "change", cursor: cursor(0), event: event("first") });
          await flush();
          harness.emit(0, { type: "change", cursor: cursor(1), event: event("second") });
          await flush();
          expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(0)]]);
          expect(harness.taskViewSync.reconcileExternalEvent).toHaveBeenCalledTimes(2);
        }
        stop = harness.controller.stop();
        expect(harness.controller.stop()).toBe(stop);
        let stopped = false;
        void stop.then(() => {
          stopped = true;
        });
        acquired.resolve();
        await flush();

        expect(firstStart).toBe(secondStart);
        expect(harness.transport.subscribeTaskStream).toHaveBeenCalledTimes(1);
        expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);
        expect(stopped).toBe(false);

        teardown.resolve();
        await flush();
        expect(stopped).toBe(true);
        if (pending !== "acquisition") {
          harness.emit(0, { type: "change", cursor: cursor(2), event: event("stopped") });
          harness.emit(0, { type: "snapshot_required", cursor: cursor(9), reason: "buffer_gap" });
          harness.failTerminally(0, new Error("obsolete stream ended"));
          if (pending === "acknowledgement-failure")
            acknowledgement.reject(new Error("obsolete acknowledgement failed"));
          else acknowledgement.resolve();
          await flush();

          expect(harness.records[0]?.acknowledge.mock.calls).toEqual([[cursor(0)]]);
          expect(harness.taskViewSync.reconcileExternalEvent).toHaveBeenCalledTimes(2);
          expect(harness.taskViewSync.reconcileStreamSnapshot).not.toHaveBeenCalled();
          expect(harness.transport.subscribeTaskStream).toHaveBeenCalledTimes(1);
          expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);
          expect(harness.onDegraded).not.toHaveBeenCalled();
        }
      } finally {
        acquired.resolve();
        acknowledgement.resolve();
        teardown.resolve();
        await Promise.all([firstStart, secondStart, stop ?? harness.controller.stop()]);
      }
    },
  );

  test("ignores frames delivered by the closed subscription", async () => {
    const harness = createHarness({
      taskViewSync: {
        reconcileExternalEvent: async () => {
          throw new Error("application failed");
        },
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("failed") });
    await flush();
    expect(harness.records).toHaveLength(2);

    harness.emit(0, { type: "snapshot_required", cursor: cursor(99), reason: "buffer_gap" });
    await flush();

    expect(harness.taskViewSync.reconcileStreamSnapshot).not.toHaveBeenCalled();
    expect(harness.transport.subscribeTaskStream).toHaveBeenCalledTimes(2);
  });
});
