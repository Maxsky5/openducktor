import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createTaskCardFixture } from "../test-support/shared-test-fixtures";
import { documentQueryKeys } from "./documents";
import { createTaskViewSync, type TaskViewSyncPorts } from "./task-view-sync";
import { boardEvent, eventCursor } from "./task-view-sync.test-support";
import { taskQueryKeys, type RepoTaskData } from "./tasks";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const createPorts = (overrides: Partial<TaskViewSyncPorts> = {}): TaskViewSyncPorts => ({
  listTasks: async () => [createTaskCardFixture({ id: "task-1", status: "open" })],
  loadFreshDocument: async () => ({ markdown: "# Fresh", updatedAt: "2026-04-10T13:10:00.000Z" }),
  ...overrides,
});

const createSync = (ports: TaskViewSyncPorts) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, sync: createTaskViewSync({ queryClient, ports }) };
};

describe("TaskViewSync races", () => {
  test.each(["removed", "failed"] as const)(
    "drops pending changes after a query is %s",
    async (change) => {
      const result = createDeferred<RepoTaskData>();
      const { queryClient, sync } = createSync(createPorts());
      const key = taskQueryKeys.repoData("/repo");
      const read = queryClient.fetchQuery({ queryKey: key, queryFn: () => result.promise });
      void read.catch(() => {});
      await sync.reconcileExternalEvent(
        boardEvent("/repo", [createTaskCardFixture({ id: "task-1", title: "Obsolete" })]),
        eventCursor(),
      );
      const replacement = createTaskCardFixture({ id: "task-1", title: "Replacement" });
      if (change === "removed") {
        queryClient.removeQueries({ queryKey: key, exact: true });
        queryClient.setQueryData(key, { tasks: [replacement] });
        result.resolve({ tasks: [] });
        await Promise.allSettled([read]);
      } else {
        result.reject(new Error("first read failed"));
        await Promise.allSettled([read]);
        await queryClient.fetchQuery({
          queryKey: key,
          queryFn: async () => ({ tasks: [replacement] }),
        });
      }
      expect(queryClient.getQueryData<RepoTaskData>(key)).toEqual({ tasks: [replacement] });
      queryClient.clear();
    },
  );

  test("applies a burst once after the original inactive board and ID reads complete", async () => {
    const result = createDeferred<RepoTaskData>();
    const ids = createDeferred<string[]>();
    const { queryClient, sync } = createSync(createPorts());
    const queryKey = taskQueryKeys.repoData("/inactive");
    const idKey = taskQueryKeys.ids("/inactive");
    const readBoard = mock(() => result.promise);
    const readIds = mock(() => ids.promise);
    const options = { queryKey, queryFn: readBoard, gcTime: 0 };
    const read = queryClient.fetchQuery(options);
    const idRead = queryClient.fetchQuery({ queryKey: idKey, queryFn: readIds });
    const observer = new QueryObserver(queryClient, options);
    const stopObserving = observer.subscribe(() => {});
    const writes: string[] = [];
    const stopRecording = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success" && event.action.manual) {
        writes.push(event.query.queryHash);
      }
    });
    let changed = createTaskCardFixture({ id: "task-1" });
    const other = createTaskCardFixture({ id: "task-2" });
    try {
      stopObserving();
      for (let index = 0; index < 50; index++) {
        changed = createTaskCardFixture({ id: "task-1", title: `Changed ${index}` });
        await sync.reconcileExternalEvent(boardEvent("/inactive", [changed]), eventCursor());
      }
      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
      expect(queryClient.getQueryData(idKey)).toBeUndefined();
      expect(writes).toEqual([]);
      result.resolve({ tasks: [createTaskCardFixture({ id: "task-1" }), other] });
      ids.resolve(["task-1", "task-2"]);
      await Promise.all([read, idRead]);
      expect(queryClient.getQueryData<RepoTaskData>(queryKey)?.tasks).toEqual([changed, other]);
      expect(queryClient.getQueryData<string[]>(idKey)).toEqual(["task-1", "task-2"]);
      expect(writes).toHaveLength(2);
      expect(new Set(writes).size).toBe(2);
      expect(readBoard).toHaveBeenCalledTimes(1);
      expect(readIds).toHaveBeenCalledTimes(1);
    } finally {
      result.resolve({ tasks: [] });
      ids.resolve([]);
      await Promise.all([read, idRead]);
      stopObserving();
      stopRecording();
      queryClient.clear();
    }
  });

  test.each(["cached", "pending"] as const)(
    "%s boards preserve deletion, recreation, and closed visibility in event order",
    async (baseline) => {
      const result = createDeferred<RepoTaskData>();
      const ids = createDeferred<string[]>();
      const { queryClient, sync } = createSync(createPorts());
      const queryKey = taskQueryKeys.repoData("/repo");
      const idKey = taskQueryKeys.ids("/repo");
      const early = createTaskCardFixture({ id: "early" });
      const item = createTaskCardFixture({ id: "item" });
      const other = createTaskCardFixture({ id: "other" });
      const hidden = createTaskCardFixture({
        id: "hidden",
        status: "closed",
        updatedAt: "2026-04-08T00:00:00.000Z",
      });
      const edge = createTaskCardFixture({
        id: "edge",
        status: "closed",
        updatedAt: "2026-04-09T13:10:00.000Z",
      });
      const old = createTaskCardFixture({ id: "old" });
      const moving = createTaskCardFixture({
        id: "moving",
        status: "closed",
        updatedAt: "2026-04-01T00:00:00.000Z",
      });
      const tasks = [early, item, other, hidden, edge, old, moving];
      const taskIds = tasks.map((card) => card.id);
      if (baseline === "cached") {
        queryClient.setQueryData(queryKey, { tasks });
        queryClient.setQueryData(idKey, taskIds);
      }
      const read =
        baseline === "pending"
          ? queryClient.fetchQuery({ queryKey, queryFn: () => result.promise })
          : Promise.resolve();
      const idRead =
        baseline === "pending"
          ? queryClient.fetchQuery({ queryKey: idKey, queryFn: () => ids.promise })
          : Promise.resolve();
      const earlyChanged = Object.freeze({ ...early, title: "Changed early" });
      const firstItem = Object.freeze({ ...item, title: "First item" });
      const moved = Object.freeze({ ...moving, status: "open" as const });
      const marker = Object.freeze(createTaskCardFixture({ id: "marker" }));
      const lastItem = Object.freeze({ ...item, title: "Latest item" });
      const restored = Object.freeze({ ...old, title: "Recreated" });
      const reopened = Object.freeze({ ...edge, status: "open" as const });
      try {
        await sync.reconcileExternalEvent(
          boardEvent("/repo", [earlyChanged, firstItem, moved], { removedTaskIds: ["old"] }),
          eventCursor(),
        );
        await sync.reconcileExternalEvent(
          boardEvent("/repo", [marker], { doneVisibleDays: 0 }),
          eventCursor(),
        );
        await sync.reconcileExternalEvent(
          boardEvent("/repo", [lastItem, restored, reopened], { doneVisibleDays: 7 }),
          eventCursor(),
        );
        result.resolve({ tasks });
        ids.resolve(taskIds);
        await Promise.all([read, idRead]);
        expect(queryClient.getQueryData<RepoTaskData>(queryKey)?.tasks).toEqual([
          { ...earlyChanged },
          reopened,
          lastItem,
          marker,
          moved,
          restored,
          other,
        ]);
        expect(queryClient.getQueryData<string[]>(idKey)).toEqual([
          "early",
          "item",
          "other",
          "hidden",
          "edge",
          "moving",
          "marker",
          "old",
        ]);
      } finally {
        result.resolve({ tasks: [] });
        ids.resolve([]);
        await Promise.all([read, idRead]);
        queryClient.clear();
      }
    },
  );

  test("a manual refresh supersedes card patches waiting for a cancelled cold read", async () => {
    const staleRead = createDeferred<RepoTaskData>();
    const latest = createTaskCardFixture({ id: "task-1", title: "Latest host snapshot" });
    const queued = createTaskCardFixture({ id: "task-1", title: "Earlier stream change" });
    const { queryClient, sync } = createSync(createPorts({ listTasks: async () => [latest] }));
    const key = taskQueryKeys.repoData("/repo");
    const coldRead = queryClient.fetchQuery({ queryKey: key, queryFn: () => staleRead.promise });
    void coldRead.catch(() => {});
    await sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "earlier-change",
        repoPath: "/repo",
        taskIds: [queued.id],
        removedTaskIds: [],
        taskSnapshots: [{ id: queued.id, title: queued.title, status: queued.status }],
        statusChanges: [],
        boardChanges: { artifactChanges: [], cards: [queued], doneVisibleDays: 1 },
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      eventCursor(),
    );

    await sync.refreshManually("/repo");
    expect(queryClient.getQueryData<RepoTaskData>(key)).toEqual({ tasks: [latest] });
    staleRead.resolve({ tasks: [createTaskCardFixture({ id: "task-1", title: "Old read" })] });
    await Promise.allSettled([coldRead]);
    expect(queryClient.getQueryData<RepoTaskData>(key)).toEqual({ tasks: [latest] });
    queryClient.clear();
  });

  test("uses the snapshot task read for a workspace load started at the same time", async () => {
    const taskList = createDeferred<TaskCard[]>();
    const taskListStarted = createDeferred<void>();
    const listTasks = mock(async () => {
      taskListStarted.resolve();
      return taskList.promise;
    });
    const { sync } = createSync(createPorts({ listTasks }));

    const snapshot = sync.reconcileStreamSnapshot(["/repo"]);
    const workspaceLoad = sync.loadWorkspace("/repo");
    void workspaceLoad.catch(() => {});

    try {
      await taskListStarted.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(listTasks).toHaveBeenCalledTimes(1);

      taskList.resolve([createTaskCardFixture({ id: "task-1" })]);
      await expect(snapshot).resolves.toEqual({
        taskIdsByRepo: new Map([["/repo", ["task-1"]]]),
        failures: new Map(),
      });
      await expect(workspaceLoad).resolves.toBeUndefined();
    } finally {
      taskList.resolve([createTaskCardFixture({ id: "task-1" })]);
      await Promise.allSettled([snapshot, workspaceLoad]);
    }
  });

  test("queues a task-retention refresh after a workspace load", async () => {
    const firstTaskList = createDeferred<TaskCard[]>();
    const firstTaskListStarted = createDeferred<void>();
    const tasks = [createTaskCardFixture({ id: "task-1" })];
    const listTasks = mock(async () => {
      if (listTasks.mock.calls.length === 1) {
        firstTaskListStarted.resolve();
        return firstTaskList.promise;
      }
      return tasks;
    });
    const { queryClient, sync } = createSync(createPorts({ listTasks }));

    const workspaceLoad = sync.loadWorkspace("/repo", { forceFresh: true });
    await firstTaskListStarted.promise;
    const retentionRefresh = sync.refreshAfterTaskRetentionChange(["/repo"]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(listTasks).toHaveBeenCalledTimes(1);
    firstTaskList.resolve(tasks);
    await Promise.all([workspaceLoad, retentionRefresh]);
    expect(listTasks).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo"))).toEqual({
      tasks,
    });
  });

  test("runs the next task view refresh after an earlier refresh fails", async () => {
    const firstFailure = new Error("task list unavailable");
    let reads = 0;
    const { queryClient, sync } = createSync(
      createPorts({
        listTasks: async () => {
          reads += 1;
          if (reads === 1) throw firstFailure;
          return [createTaskCardFixture({ id: "fresh" })];
        },
      }),
    );

    const first = sync.refreshManually("/repo");
    const second = sync.refreshManually("/repo");

    await expect(first).rejects.toBe(firstFailure);
    await expect(second).resolves.toBeUndefined();
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo"))?.tasks[0]
        ?.id,
    ).toBe("fresh");
  });

  test("runs task view refreshes one at a time per repository", async () => {
    const firstCancelStarted = createDeferred<void>();
    const releaseFirstCancel = createDeferred<void>();
    let reads = 0;
    const { queryClient, sync } = createSync(
      createPorts({
        listTasks: async () => {
          reads += 1;
          return [createTaskCardFixture({ id: `task-${reads}` })];
        },
      }),
    );
    const cancelQueries = queryClient.cancelQueries.bind(queryClient);
    let cancellations = 0;
    queryClient.cancelQueries = async (...args) => {
      cancellations += 1;
      if (cancellations === 1) {
        firstCancelStarted.resolve();
        await releaseFirstCancel.promise;
      }
      return cancelQueries(...args);
    };

    const first = sync.refreshManually("/repo");
    await firstCancelStarted.promise;
    const second = sync.refreshManually("/repo");

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(reads).toBe(0);

      releaseFirstCancel.resolve();
      await Promise.all([first, second]);

      expect(
        queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo"))?.tasks[0]
          ?.id,
      ).toBe("task-2");
    } finally {
      releaseFirstCancel.resolve();
      await Promise.allSettled([first, second]);
      queryClient.cancelQueries = cancelQueries;
    }
  });

  test("cancels a pre-snapshot document read before invalidation so it cannot restore stale data", async () => {
    const staleDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const staleDocumentStarted = createDeferred<void>();
    const { queryClient, sync } = createSync(
      createPorts({
        loadFreshDocument: async () => ({
          markdown: "# Fresh snapshot",
          updatedAt: "2026-04-10T13:11:00.000Z",
        }),
      }),
    );
    const documentKey = documentQueryKeys.document("/repo", "task-1", "spec");
    queryClient.setQueryData(documentKey, { markdown: "# Stale", updatedAt: null });
    const observer = new QueryObserver(queryClient, {
      queryKey: documentKey,
      queryFn: async () => {
        staleDocumentStarted.resolve();
        return staleDocument.promise;
      },
      staleTime: 0,
    });
    const unsubscribe = observer.subscribe(() => {});
    const calls: string[] = [];
    const cancelQueries = mock(queryClient.cancelQueries.bind(queryClient));
    const invalidateQueries = mock(queryClient.invalidateQueries.bind(queryClient));
    queryClient.cancelQueries = async (...args) => {
      if (args[0]?.queryKey?.[0] === documentQueryKeys.all[0]) calls.push("cancel");
      return cancelQueries(...args);
    };
    queryClient.invalidateQueries = async (...args) => {
      if (args[0]?.queryKey?.[0] === documentQueryKeys.all[0]) calls.push("invalidate");
      return invalidateQueries(...args);
    };

    try {
      await staleDocumentStarted.promise;
      await sync.reconcileStreamSnapshot(["/repo"]);

      expect(calls.indexOf("cancel")).toBeLessThan(calls.indexOf("invalidate"));
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(documentKey),
      ).toEqual({
        markdown: "# Fresh snapshot",
        updatedAt: "2026-04-10T13:11:00.000Z",
      });

      staleDocument.resolve({ markdown: "# Restored stale", updatedAt: null });
      await Promise.resolve();
      await Promise.resolve();

      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(documentKey),
      ).toEqual({
        markdown: "# Fresh snapshot",
        updatedAt: "2026-04-10T13:11:00.000Z",
      });
      expect(queryClient.getQueryState(documentKey)?.isInvalidated).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  test("cancels snapshot document reads per repo and refreshes only active documents", async () => {
    const activeStaleDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const inactiveStaleDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const activeStaleStarted = createDeferred<void>();
    const inactiveStaleStarted = createDeferred<void>();
    const loadFreshDocument = mock(async () => ({
      markdown: "# Fresh snapshot",
      updatedAt: "2026-04-10T13:11:00.000Z",
    }));
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    const activeDocumentKey = documentQueryKeys.document("/repo", "task-1", "spec");
    const inactiveDocumentKey = documentQueryKeys.document("/inactive", "task-1", "spec");
    queryClient.setQueryData(activeDocumentKey, { markdown: "# Active cached", updatedAt: null });
    queryClient.setQueryData(inactiveDocumentKey, {
      markdown: "# Inactive cached",
      updatedAt: null,
    });
    const activeObserver = new QueryObserver(queryClient, {
      queryKey: activeDocumentKey,
      queryFn: async () => {
        activeStaleStarted.resolve();
        return activeStaleDocument.promise;
      },
      staleTime: 0,
    });
    const inactiveObserver = new QueryObserver(queryClient, {
      queryKey: inactiveDocumentKey,
      queryFn: async () => {
        inactiveStaleStarted.resolve();
        return inactiveStaleDocument.promise;
      },
      staleTime: 0,
    });
    const unsubscribeActive = activeObserver.subscribe(() => {});
    const unsubscribeInactive = inactiveObserver.subscribe(() => {});

    try {
      await Promise.all([activeStaleStarted.promise, inactiveStaleStarted.promise]);
      await sync.reconcileStreamSnapshot(["/repo"]);

      activeStaleDocument.resolve({ markdown: "# Late active", updatedAt: null });
      inactiveStaleDocument.resolve({ markdown: "# Late inactive", updatedAt: null });
      await Promise.resolve();
      await Promise.resolve();

      expect(loadFreshDocument).toHaveBeenCalledWith("/repo", "task-1", "spec");
      expect(loadFreshDocument).not.toHaveBeenCalledWith("/inactive", "task-1", "spec");
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(activeDocumentKey),
      ).toEqual({
        markdown: "# Fresh snapshot",
        updatedAt: "2026-04-10T13:11:00.000Z",
      });
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          inactiveDocumentKey,
        ),
      ).toEqual({
        markdown: "# Inactive cached",
        updatedAt: null,
      });
      expect(queryClient.getQueryState(inactiveDocumentKey)?.isInvalidated).toBe(true);
    } finally {
      activeStaleDocument.resolve({ markdown: "# Late active", updatedAt: null });
      inactiveStaleDocument.resolve({ markdown: "# Late inactive", updatedAt: null });
      unsubscribeActive();
      unsubscribeInactive();
    }
  });
});
