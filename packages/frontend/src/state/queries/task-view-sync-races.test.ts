import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot, TaskCard } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  createSettingsSnapshotFixture,
  createTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import { documentQueryKeys } from "./documents";
import { createTaskViewSync, type TaskViewSyncPorts } from "./task-view-sync";
import { taskQueryKeys } from "./tasks";
import { workspaceQueryKeys } from "./workspace";

const doneVisibleDays = 1;
const settings: SettingsSnapshot = createSettingsSnapshotFixture({
  kanban: { doneVisibleDays },
});

const createDeferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const waitFor = async (predicate: () => boolean, remainingAttempts = 20): Promise<void> => {
  if (predicate()) return;
  if (remainingAttempts === 0) throw new Error("Expected condition was not met.");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await waitFor(predicate, remainingAttempts - 1);
};

const createPorts = (overrides: Partial<TaskViewSyncPorts> = {}): TaskViewSyncPorts => ({
  loadSettings: async () => settings,
  listTasks: async () => [createTaskCardFixture({ id: "task-1", status: "open" })],
  loadFreshDocument: async () => ({ markdown: "# Fresh", updatedAt: "2026-04-10T13:10:00.000Z" }),
  ...overrides,
});

const createSync = (ports: TaskViewSyncPorts) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settings);
  return { queryClient, sync: createTaskViewSync({ queryClient, ports }) };
};

describe("TaskViewSync races", () => {
  test("supersedes an older active external document refresh with the latest event", async () => {
    const firstDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const secondDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const firstDocumentStarted = createDeferred<void>();
    const secondDocumentStarted = createDeferred<void>();
    let documentReadCount = 0;
    const { queryClient, sync } = createSync(
      createPorts({
        loadFreshDocument: async () => {
          documentReadCount += 1;
          if (documentReadCount === 1) {
            firstDocumentStarted.resolve();
            return firstDocument.promise;
          }
          secondDocumentStarted.resolve();
          return secondDocument.promise;
        },
      }),
    );
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    const first = sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-5",
        repoPath: "/repo",
        taskIds: ["task-1"],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      "/repo",
    );
    await firstDocumentStarted.promise;

    const second = sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-6",
        repoPath: "/repo",
        taskIds: ["task-1"],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:11:00.000Z",
      },
      "/repo",
    );
    await secondDocumentStarted.promise;

    secondDocument.resolve({ markdown: "# V2", updatedAt: "2026-04-10T13:11:00.000Z" });
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);

    firstDocument.resolve({ markdown: "# V1", updatedAt: "2026-04-10T13:10:00.000Z" });
    await Promise.resolve();
    expect(
      queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
        documentQueryKeys.spec("/repo", "task-1"),
      ),
    ).toEqual({ markdown: "# V2", updatedAt: "2026-04-10T13:11:00.000Z" });
  });

  test("joins a completed successor after an older external event finishes late", async () => {
    const firstDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const firstDocumentStarted = createDeferred<void>();
    const { queryClient, sync } = createSync(
      createPorts({
        loadFreshDocument: async (_repoPath, taskId) => {
          if (taskId === "task-a") {
            firstDocumentStarted.resolve();
            return firstDocument.promise;
          }
          return { markdown: "# B2", updatedAt: "2026-04-10T13:11:00.000Z" };
        },
      }),
    );
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-a"), {
      markdown: "# A0",
      updatedAt: null,
    });
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-b"), {
      markdown: "# B0",
      updatedAt: null,
    });

    const first = sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-8",
        repoPath: "/repo",
        taskIds: ["task-a"],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      "/repo",
    );
    await firstDocumentStarted.promise;

    await sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-9",
        repoPath: "/repo",
        taskIds: ["task-b"],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:11:00.000Z",
      },
      "/repo",
    );

    let firstSettled = false;
    void first.then(() => {
      firstSettled = true;
    });
    firstDocument.resolve({ markdown: "# A1", updatedAt: "2026-04-10T13:10:00.000Z" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(firstSettled).toBe(true);
    await expect(first).resolves.toBeUndefined();
    expect(
      queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
        documentQueryKeys.spec("/repo", "task-b"),
      ),
    ).toEqual({ markdown: "# B2", updatedAt: "2026-04-10T13:11:00.000Z" });
  });

  test("rejects a late predecessor with its failed successor error", async () => {
    const firstDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const firstDocumentStarted = createDeferred<void>();
    const successorFailure = new Error("task list unavailable");
    let listReadCount = 0;
    const { queryClient, sync } = createSync(
      createPorts({
        listTasks: async () => {
          listReadCount += 1;
          if (listReadCount === 2) {
            throw successorFailure;
          }
          return [createTaskCardFixture({ id: "task-a", status: "open" })];
        },
        loadFreshDocument: async (_repoPath, taskId) => {
          if (taskId === "task-a") {
            firstDocumentStarted.resolve();
            return firstDocument.promise;
          }
          return { markdown: "# B", updatedAt: "2026-04-10T13:11:00.000Z" };
        },
      }),
    );
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-a"), {
      markdown: "# A0",
      updatedAt: null,
    });
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-b"), {
      markdown: "# B0",
      updatedAt: null,
    });

    const first = sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-10",
        repoPath: "/repo",
        taskIds: ["task-a"],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      "/repo",
    );
    const firstResult = first.then(
      () => null,
      (error) => error,
    );
    await firstDocumentStarted.promise;

    const second = sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-11",
        repoPath: "/repo",
        taskIds: ["task-b"],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:11:00.000Z",
      },
      "/repo",
    );
    const secondResult = second.then(
      () => null,
      (error) => error,
    );

    expect(await secondResult).toBe(successorFailure);
    firstDocument.resolve({ markdown: "# A1", updatedAt: "2026-04-10T13:10:00.000Z" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(await firstResult).toBe(successorFailure);
  });

  test("joins the winning local mutation refresh after cancellation", async () => {
    const staleRead = createDeferred<TaskCard[]>();
    let calls = 0;
    const { queryClient, sync } = createSync(
      createPorts({
        listTasks: async () => {
          calls += 1;
          return calls === 1 ? staleRead.promise : [createTaskCardFixture({ id: "fresh" })];
        },
      }),
    );

    const first = sync.refreshAfterLocalMutation("/repo", { kind: "task-list-only" });
    await waitFor(() => calls === 1);
    const second = sync.refreshAfterLocalMutation("/repo", { kind: "task-list-only" });
    await waitFor(() => calls === 2);

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(
        taskQueryKeys.repoData("/repo", doneVisibleDays),
      )?.tasks[0]?.id,
    ).toBe("fresh");
    staleRead.resolve([createTaskCardFixture({ id: "stale" })]);
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
    const documentKey = documentQueryKeys.spec("/repo", "task-1");
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
      await sync.reconcileStreamSnapshot("/repo");

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

  test("keeps snapshot document refresh work after a task-list-only successor wins", async () => {
    const snapshotList = createDeferred<TaskCard[]>();
    const snapshotListStarted = createDeferred<void>();
    const freshDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const freshDocumentStarted = createDeferred<void>();
    let listReads = 0;
    const { queryClient, sync } = createSync(
      createPorts({
        listTasks: async () => {
          listReads += 1;
          if (listReads === 1) {
            snapshotListStarted.resolve();
            return snapshotList.promise;
          }
          return [createTaskCardFixture({ id: "task-1", status: "open" })];
        },
        loadFreshDocument: async () => {
          freshDocumentStarted.resolve();
          return freshDocument.promise;
        },
      }),
    );
    const documentKey = documentQueryKeys.spec("/repo", "task-1");
    queryClient.setQueryData(documentKey, { markdown: "# Stale", updatedAt: null });
    const observer = new QueryObserver(queryClient, {
      queryKey: documentKey,
      queryFn: async () => ({ markdown: "# Observed", updatedAt: null }),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    let snapshotSettled = false;

    try {
      const snapshot = sync.reconcileStreamSnapshot("/repo").then(() => {
        snapshotSettled = true;
      });
      await snapshotListStarted.promise;

      await sync.refreshAfterLocalMutation("/repo", { kind: "task-list-only" });
      await freshDocumentStarted.promise;

      expect(snapshotSettled).toBe(false);
      freshDocument.resolve({ markdown: "# Fresh", updatedAt: "2026-04-10T13:11:00.000Z" });
      await snapshot;

      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(documentKey),
      ).toEqual({
        markdown: "# Fresh",
        updatedAt: "2026-04-10T13:11:00.000Z",
      });
    } finally {
      snapshotList.resolve([createTaskCardFixture({ id: "task-1", status: "open" })]);
      freshDocument.resolve({ markdown: "# Fresh", updatedAt: "2026-04-10T13:11:00.000Z" });
      unsubscribe();
    }
  });

  test("waits for a newer same-task document refresh after cancelling the snapshot read", async () => {
    const snapshotDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const successorDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const snapshotDocumentStarted = createDeferred<void>();
    const successorDocumentStarted = createDeferred<void>();
    let documentReads = 0;
    const { queryClient, sync } = createSync(
      createPorts({
        loadFreshDocument: async () => {
          documentReads += 1;
          if (documentReads === 1) {
            snapshotDocumentStarted.resolve();
            return snapshotDocument.promise;
          }
          successorDocumentStarted.resolve();
          return successorDocument.promise;
        },
      }),
    );
    const documentKey = documentQueryKeys.spec("/repo", "task-1");
    queryClient.setQueryData(documentKey, { markdown: "# Stale", updatedAt: null });
    const observer = new QueryObserver(queryClient, {
      queryKey: documentKey,
      queryFn: async () => ({ markdown: "# Observed", updatedAt: null }),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    let snapshotSettled = false;

    try {
      const snapshot = sync.reconcileStreamSnapshot("/repo").then(() => {
        snapshotSettled = true;
      });
      await snapshotDocumentStarted.promise;

      const successor = sync.refreshAfterLocalMutation("/repo", {
        kind: "refresh-documents",
        taskIds: ["task-1"],
      });
      await successorDocumentStarted.promise;

      expect(snapshotSettled).toBe(false);
      successorDocument.resolve({ markdown: "# V2", updatedAt: "2026-04-10T13:11:00.000Z" });
      await Promise.all([snapshot, successor]);

      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(documentKey),
      ).toEqual({ markdown: "# V2", updatedAt: "2026-04-10T13:11:00.000Z" });
    } finally {
      snapshotDocument.resolve({ markdown: "# V1", updatedAt: "2026-04-10T13:10:00.000Z" });
      successorDocument.resolve({ markdown: "# V2", updatedAt: "2026-04-10T13:11:00.000Z" });
      unsubscribe();
    }
  });

  test("lets a snapshot replace an in-flight same-task document refresh", async () => {
    const staleDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const staleDocumentStarted = createDeferred<void>();
    let documentReads = 0;
    const { queryClient, sync } = createSync(
      createPorts({
        loadFreshDocument: async () => {
          documentReads += 1;
          if (documentReads === 1) {
            staleDocumentStarted.resolve();
            return staleDocument.promise;
          }
          return { markdown: "# V2", updatedAt: "2026-04-10T13:11:00.000Z" };
        },
      }),
    );
    const documentKey = documentQueryKeys.spec("/repo", "task-1");
    queryClient.setQueryData(documentKey, { markdown: "# Stale", updatedAt: null });
    const observer = new QueryObserver(queryClient, {
      queryKey: documentKey,
      queryFn: async () => ({ markdown: "# Observed", updatedAt: null }),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    try {
      const refresh = sync.refreshAfterLocalMutation("/repo", {
        kind: "refresh-documents",
        taskIds: ["task-1"],
      });
      await staleDocumentStarted.promise;
      const snapshot = sync.reconcileStreamSnapshot("/repo");

      await expect(Promise.all([refresh, snapshot])).resolves.toEqual([undefined, undefined]);

      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(documentKey),
      ).toEqual({ markdown: "# V2", updatedAt: "2026-04-10T13:11:00.000Z" });
    } finally {
      unsubscribe();
    }
  });

  test("waits for a deleting successor without restarting the deleted snapshot document", async () => {
    const snapshotDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const snapshotDocumentStarted = createDeferred<void>();
    const loadFreshDocument = mock(async () => {
      snapshotDocumentStarted.resolve();
      return snapshotDocument.promise;
    });
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    const documentKey = documentQueryKeys.spec("/repo", "task-1");
    queryClient.setQueryData(documentKey, { markdown: "# Stale", updatedAt: null });
    const observer = new QueryObserver(queryClient, {
      queryKey: documentKey,
      queryFn: async () => ({ markdown: "# Observed", updatedAt: null }),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    try {
      const snapshot = sync.reconcileStreamSnapshot("/repo");
      await snapshotDocumentStarted.promise;

      await sync.refreshAfterLocalMutation("/repo", {
        kind: "remove-documents",
        taskIds: ["task-1"],
      });
      await snapshot;

      expect(loadFreshDocument).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryData(documentKey)).toBeUndefined();
    } finally {
      snapshotDocument.resolve({ markdown: "# V1", updatedAt: "2026-04-10T13:10:00.000Z" });
      unsubscribe();
    }
  });

  test("propagates a same-task successor document refresh failure to the snapshot", async () => {
    const snapshotDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const snapshotDocumentStarted = createDeferred<void>();
    const successorDocumentStarted = createDeferred<void>();
    const successorFailure = new Error("successor document unavailable");
    let rejectSuccessorDocument!: (error: unknown) => void;
    const successorDocument = new Promise<never>((_resolve, reject) => {
      rejectSuccessorDocument = reject;
    });
    let documentReads = 0;
    const { queryClient, sync } = createSync(
      createPorts({
        loadFreshDocument: async () => {
          documentReads += 1;
          if (documentReads === 1) {
            snapshotDocumentStarted.resolve();
            return snapshotDocument.promise;
          }
          successorDocumentStarted.resolve();
          return successorDocument;
        },
      }),
    );
    const documentKey = documentQueryKeys.spec("/repo", "task-1");
    queryClient.setQueryData(documentKey, { markdown: "# Stale", updatedAt: null });
    const observer = new QueryObserver(queryClient, {
      queryKey: documentKey,
      queryFn: async () => ({ markdown: "# Observed", updatedAt: null }),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    try {
      const snapshotResult = sync.reconcileStreamSnapshot("/repo").then(
        () => null,
        (error) => error,
      );
      await snapshotDocumentStarted.promise;
      const successorResult = sync
        .refreshAfterLocalMutation("/repo", {
          kind: "refresh-documents",
          taskIds: ["task-1"],
        })
        .then(
          () => null,
          (error) => error,
        );
      await successorDocumentStarted.promise;

      rejectSuccessorDocument(successorFailure);

      expect(await successorResult).toBe(successorFailure);
      expect(await snapshotResult).toBe(successorFailure);
    } finally {
      snapshotDocument.resolve({ markdown: "# V1", updatedAt: "2026-04-10T13:10:00.000Z" });
      unsubscribe();
    }
  });

  test("cancels a stale active event document read before fresh reconciliation", async () => {
    const staleDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const staleDocumentStarted = createDeferred<void>();
    const { queryClient, sync } = createSync(
      createPorts({
        loadFreshDocument: async () => ({
          markdown: "# Fresh event",
          updatedAt: "2026-04-10T13:11:00.000Z",
        }),
      }),
    );
    const documentKey = documentQueryKeys.spec("/repo", "task-1");
    queryClient.setQueryData(documentKey, { markdown: "# Cached stale", updatedAt: null });
    const observer = new QueryObserver(queryClient, {
      queryKey: documentKey,
      queryFn: async () => {
        staleDocumentStarted.resolve();
        return staleDocument.promise;
      },
      staleTime: 0,
    });
    const unsubscribe = observer.subscribe(() => {});

    try {
      await staleDocumentStarted.promise;
      await sync.reconcileExternalEvent(
        {
          kind: "tasks_updated",
          eventId: "event-active-stale-read",
          repoPath: "/repo",
          taskIds: ["task-1"],
          removedTaskIds: [],
          emittedAt: "2026-04-10T13:11:00.000Z",
        },
        "/repo",
      );

      staleDocument.resolve({ markdown: "# Late stale", updatedAt: null });
      await Promise.resolve();
      await Promise.resolve();

      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(documentKey),
      ).toEqual({
        markdown: "# Fresh event",
        updatedAt: "2026-04-10T13:11:00.000Z",
      });
      expect(queryClient.getQueryState(documentKey)?.isInvalidated).toBe(false);
    } finally {
      staleDocument.resolve({ markdown: "# Late stale", updatedAt: null });
      unsubscribe();
    }
  });

  test("cancels a stale inactive event document read without eagerly refreshing it", async () => {
    const staleDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const staleDocumentStarted = createDeferred<void>();
    const loadFreshDocument = mock(async () => ({ markdown: "# Unexpected", updatedAt: null }));
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    const documentKey = documentQueryKeys.spec("/inactive", "task-1");
    queryClient.setQueryData(documentKey, { markdown: "# Cached stale", updatedAt: null });
    const observer = new QueryObserver(queryClient, {
      queryKey: documentKey,
      queryFn: async () => {
        staleDocumentStarted.resolve();
        return staleDocument.promise;
      },
      staleTime: 0,
    });
    const unsubscribe = observer.subscribe(() => {});

    try {
      await staleDocumentStarted.promise;
      await sync.reconcileExternalEvent(
        {
          kind: "tasks_updated",
          eventId: "event-inactive-stale-read",
          repoPath: "/inactive",
          taskIds: ["task-1"],
          removedTaskIds: [],
          emittedAt: "2026-04-10T13:11:00.000Z",
        },
        "/repo",
      );

      staleDocument.resolve({ markdown: "# Late stale", updatedAt: null });
      await Promise.resolve();
      await Promise.resolve();

      expect(loadFreshDocument).not.toHaveBeenCalled();
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(documentKey),
      ).toEqual({
        markdown: "# Cached stale",
        updatedAt: null,
      });
      expect(queryClient.getQueryState(documentKey)?.isInvalidated).toBe(true);
    } finally {
      staleDocument.resolve({ markdown: "# Late stale", updatedAt: null });
      unsubscribe();
    }
  });

  test("coordinates an inactive event with a cancelled local task-list refresh", async () => {
    const staleList = createDeferred<TaskCard[]>();
    const staleListStarted = createDeferred<void>();
    const listTasks = mock(async () => {
      staleListStarted.resolve();
      return staleList.promise;
    });
    const loadFreshDocument = mock(async () => ({ markdown: "# Unexpected", updatedAt: null }));
    const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
    const taskKey = taskQueryKeys.repoData("/inactive", doneVisibleDays);
    const documentKey = documentQueryKeys.spec("/inactive", "task-1");
    queryClient.setQueryData(taskKey, {
      tasks: [createTaskCardFixture({ id: "task-1", status: "open" })],
    });
    queryClient.setQueryData(documentKey, { markdown: "# Stale", updatedAt: null });

    const refresh = sync.refreshAfterLocalMutation("/inactive", { kind: "task-list-only" });
    await staleListStarted.promise;
    const event = sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-inactive-remove",
        repoPath: "/inactive",
        taskIds: ["task-1"],
        removedTaskIds: ["task-1"],
        emittedAt: "2026-04-10T13:11:00.000Z",
      },
      "/active",
    );

    await expect(Promise.all([refresh, event])).resolves.toEqual([undefined, undefined]);

    expect(listTasks).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(taskKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(documentKey)).toBeUndefined();
    expect(loadFreshDocument).not.toHaveBeenCalled();
  });

  test("globally cancels snapshot document reads while only refreshing retained active documents", async () => {
    const activeStaleDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const inactiveStaleDocument = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const activeStaleStarted = createDeferred<void>();
    const inactiveStaleStarted = createDeferred<void>();
    const loadFreshDocument = mock(async () => ({
      markdown: "# Fresh snapshot",
      updatedAt: "2026-04-10T13:11:00.000Z",
    }));
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    const activeDocumentKey = documentQueryKeys.spec("/repo", "task-1");
    const inactiveDocumentKey = documentQueryKeys.spec("/inactive", "task-1");
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
      await sync.reconcileStreamSnapshot("/repo");

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
