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

const observeDocument = (queryClient: QueryClient, queryKey: readonly unknown[]) =>
  new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => ({ markdown: "# Observed", updatedAt: null }),
    staleTime: Infinity,
  }).subscribe(() => {});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const recordQueryOperations = (queryClient: QueryClient): string[] => {
  const calls: string[] = [];
  const cancelQueries = queryClient.cancelQueries.bind(queryClient);
  const invalidateQueries = queryClient.invalidateQueries.bind(queryClient);
  const removeQueries = queryClient.removeQueries.bind(queryClient);
  const kindFor = (filters: { queryKey?: readonly unknown[] } | undefined): string | null => {
    if (filters?.queryKey?.[0] === documentQueryKeys.all[0]) return "documents";
    if (filters?.queryKey?.[0] === taskQueryKeys.all[0]) return "tasks";
    return null;
  };
  queryClient.cancelQueries = async (...args) => {
    const kind = kindFor(args[0]);
    if (kind) calls.push(`cancel:${kind}`);
    return cancelQueries(...args);
  };
  queryClient.invalidateQueries = async (...args) => {
    const kind = kindFor(args[0]);
    if (kind) calls.push(`invalidate:${kind}`);
    return invalidateQueries(...args);
  };
  queryClient.removeQueries = (...args) => {
    const kind = kindFor(args[0]);
    if (kind) calls.push(`remove:${kind}`);
    return removeQueries(...args);
  };
  return calls;
};

describe("TaskViewSync", () => {
  test("reconciles active external updates with fresh cached documents", async () => {
    const loadFreshDocument = mock(async () => ({
      markdown: "# Updated",
      updatedAt: "2026-04-10T13:10:00.000Z",
    }));
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    await sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-1",
        repoPath: "/repo",
        taskIds: ["task-1"],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      "/repo",
    );

    expect(loadFreshDocument).toHaveBeenCalledWith("/repo", "task-1", "spec");
    expect(
      queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
        documentQueryKeys.spec("/repo", "task-1"),
      ),
    ).toEqual({
      markdown: "# Updated",
      updatedAt: "2026-04-10T13:10:00.000Z",
    });
  });

  test("invalidates retained active documents once before refreshing them", async () => {
    const { queryClient, sync } = createSync(createPorts());
    const invalidateQueries = mock(queryClient.invalidateQueries.bind(queryClient));
    queryClient.invalidateQueries = invalidateQueries;
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    await sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-1b",
        repoPath: "/repo",
        taskIds: ["task-1"],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      "/repo",
    );

    const documentInvalidations = invalidateQueries.mock.calls.filter(
      ([filters]) => filters?.queryKey?.[0] === documentQueryKeys.all[0],
    );
    expect(documentInvalidations).toHaveLength(1);
  });

  test("cancels active event documents and task lists before removing or invalidating", async () => {
    const { queryClient, sync } = createSync(createPorts());
    const calls = recordQueryOperations(queryClient);
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", doneVisibleDays), { tasks: [] });
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Retained",
      updatedAt: null,
    });
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "removed-task"), {
      markdown: "# Removed",
      updatedAt: null,
    });

    await sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-cancel-active",
        repoPath: "/repo",
        taskIds: ["task-1", "removed-task"],
        removedTaskIds: ["removed-task"],
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      "/repo",
    );

    expect(calls.indexOf("cancel:documents")).toBeLessThan(calls.indexOf("remove:documents"));
    expect(calls.indexOf("cancel:documents")).toBeLessThan(calls.indexOf("invalidate:documents"));
    expect(calls.indexOf("cancel:tasks")).toBeLessThan(calls.indexOf("invalidate:tasks"));
  });

  test("removes explicit external deletions without inferring from the task list", async () => {
    const { queryClient, sync } = createSync(createPorts());
    queryClient.setQueryData(documentQueryKeys.plan("/repo", "task-1"), {
      markdown: "# Removed",
      updatedAt: null,
    });

    await sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-2",
        repoPath: "/repo",
        taskIds: ["task-1"],
        removedTaskIds: ["task-1"],
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      "/repo",
    );

    expect(queryClient.getQueryData(documentQueryKeys.plan("/repo", "task-1"))).toBeUndefined();
  });

  test("invalidates inactive repository caches without fetching", async () => {
    const listTasks = mock(async () => [] as TaskCard[]);
    const loadFreshDocument = mock(async () => ({ markdown: "# Fresh", updatedAt: null }));
    const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
    queryClient.setQueryData(taskQueryKeys.repoData("/inactive", doneVisibleDays), { tasks: [] });
    queryClient.setQueryData(documentQueryKeys.spec("/inactive", "task-1"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    await sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-3",
        repoPath: "/inactive",
        taskIds: ["task-1"],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      "/repo",
    );

    expect(listTasks).not.toHaveBeenCalled();
    expect(loadFreshDocument).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(taskQueryKeys.repoData("/inactive", doneVisibleDays))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(documentQueryKeys.spec("/inactive", "task-1"))?.isInvalidated,
    ).toBe(true);
  });

  test("cancels inactive event documents and task lists before invalidation", async () => {
    const { queryClient, sync } = createSync(createPorts());
    const calls = recordQueryOperations(queryClient);
    queryClient.setQueryData(taskQueryKeys.repoData("/inactive", doneVisibleDays), { tasks: [] });
    queryClient.setQueryData(documentQueryKeys.spec("/inactive", "task-1"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    await sync.reconcileExternalEvent(
      {
        kind: "tasks_updated",
        eventId: "event-cancel-inactive",
        repoPath: "/inactive",
        taskIds: ["task-1"],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      "/repo",
    );

    expect(calls.indexOf("cancel:documents")).toBeLessThan(calls.indexOf("invalidate:documents"));
    expect(calls.indexOf("cancel:tasks")).toBeLessThan(calls.indexOf("invalidate:tasks"));
  });

  test("normalizes task-created events to one affected task", async () => {
    const loadFreshDocument = mock(async () => ({ markdown: "# Created", updatedAt: null }));
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    await sync.reconcileExternalEvent(
      {
        kind: "external_task_created",
        eventId: "event-4",
        repoPath: "/repo",
        taskId: "task-1",
        emittedAt: "2026-04-10T13:10:00.000Z",
      },
      "/repo",
    );

    expect(loadFreshDocument).toHaveBeenCalledWith("/repo", "task-1", "spec");
  });

  test("leaves retained cached documents invalidated when active task-list refresh fails", async () => {
    const loadFreshDocument = mock(async () => ({ markdown: "# Fresh", updatedAt: null }));
    const { queryClient, sync } = createSync(
      createPorts({
        listTasks: async () => {
          throw new Error("task list unavailable");
        },
        loadFreshDocument,
      }),
    );
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    await expect(
      sync.reconcileExternalEvent(
        {
          kind: "tasks_updated",
          eventId: "event-7",
          repoPath: "/repo",
          taskIds: ["task-1"],
          removedTaskIds: [],
          emittedAt: "2026-04-10T13:10:00.000Z",
        },
        "/repo",
      ),
    ).rejects.toThrow("task list unavailable");

    expect(loadFreshDocument).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(documentQueryKeys.spec("/repo", "task-1"))?.isInvalidated,
    ).toBe(true);
  });

  test("propagates real refresh failures", async () => {
    const { sync } = createSync(
      createPorts({
        listTasks: async () => {
          throw new Error("task list unavailable");
        },
      }),
    );

    await expect(sync.refreshManually("/repo")).rejects.toThrow("task list unavailable");
  });

  test("reconciles snapshots without fetching cached documents that may be deleted", async () => {
    const listTasks = mock(async () => [] as TaskCard[]);
    const loadFreshDocument = mock(async () => {
      throw new Error("task no longer exists");
    });
    const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", doneVisibleDays), { tasks: [] });
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "deleted-task"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    await sync.reconcileStreamSnapshot("/repo");

    expect(loadFreshDocument).not.toHaveBeenCalled();
    expect(listTasks).toHaveBeenCalledWith("/repo", doneVisibleDays);
    expect(
      queryClient.getQueryState(documentQueryKeys.spec("/repo", "deleted-task"))?.isInvalidated,
    ).toBe(true);
  });

  test("waits for fresh retained active documents while leaving inactive cached documents invalidated", async () => {
    const freshDocument = deferred<{ markdown: string; updatedAt: string | null }>();
    const freshDocumentStarted = deferred<void>();
    const loadFreshDocument = mock(async (_repoPath, taskId, section) => {
      freshDocumentStarted.resolve();
      return freshDocument.promise.then(() => ({
        markdown: `# ${taskId} ${section}`,
        updatedAt: "2026-04-10T13:10:00.000Z",
      }));
    });
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    const activeDocumentKey = documentQueryKeys.spec("/repo", "task-1");
    const inactiveDocumentKey = documentQueryKeys.plan("/repo", "task-1");
    queryClient.setQueryData(activeDocumentKey, { markdown: "# Stale spec", updatedAt: null });
    queryClient.setQueryData(inactiveDocumentKey, { markdown: "# Stale plan", updatedAt: null });
    const unsubscribe = observeDocument(queryClient, activeDocumentKey);
    let settled = false;

    try {
      const snapshot = sync.reconcileStreamSnapshot("/repo").then(() => {
        settled = true;
      });
      await freshDocumentStarted.promise;

      expect(settled).toBe(false);
      expect(loadFreshDocument).toHaveBeenCalledWith("/repo", "task-1", "spec");
      expect(loadFreshDocument).not.toHaveBeenCalledWith("/repo", "task-1", "plan");
      expect(queryClient.getQueryState(inactiveDocumentKey)?.isInvalidated).toBe(true);

      freshDocument.resolve({ markdown: "# Fresh", updatedAt: "2026-04-10T13:10:00.000Z" });
      await snapshot;

      expect(settled).toBe(true);
      expect(queryClient.getQueryState(activeDocumentKey)?.isInvalidated).toBe(false);
      expect(queryClient.getQueryState(inactiveDocumentKey)?.isInvalidated).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  test("invalidates inactive snapshot documents without fetching their repository", async () => {
    const listTasks = mock(async () => [] as TaskCard[]);
    const loadFreshDocument = mock(async () => ({ markdown: "# Snapshot", updatedAt: null }));
    const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", doneVisibleDays), { tasks: [] });
    queryClient.setQueryData(documentQueryKeys.plan("/inactive", "task-1"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    await sync.reconcileStreamSnapshot("/repo");

    expect(listTasks).toHaveBeenCalledWith("/repo", doneVisibleDays);
    expect(listTasks).not.toHaveBeenCalledWith("/inactive", doneVisibleDays);
    expect(loadFreshDocument).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(documentQueryKeys.plan("/inactive", "task-1"))?.isInvalidated,
    ).toBe(true);
  });

  test("cancels snapshot document and inactive task queries before invalidating", async () => {
    const { queryClient, sync } = createSync(createPorts());
    const calls = recordQueryOperations(queryClient);
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", doneVisibleDays), { tasks: [] });
    queryClient.setQueryData(taskQueryKeys.repoData("/inactive", doneVisibleDays), { tasks: [] });
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Active stale",
      updatedAt: null,
    });
    queryClient.setQueryData(documentQueryKeys.spec("/inactive", "task-1"), {
      markdown: "# Inactive stale",
      updatedAt: null,
    });

    await sync.reconcileStreamSnapshot("/repo");

    expect(calls.indexOf("cancel:documents")).toBeLessThan(calls.indexOf("invalidate:documents"));
    expect(calls.indexOf("cancel:tasks")).toBeLessThan(calls.indexOf("invalidate:tasks"));
  });
});
