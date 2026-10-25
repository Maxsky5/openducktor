import { workflowArtifactId } from "@openducktor/contracts";
import { describe, expect, mock, test } from "bun:test";
import { CancelledError, QueryClient, QueryObserver } from "@tanstack/react-query";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import {
  documentQueryKeys,
  taskDocumentQueryOptions,
} from "@openducktor/frontend-core/queries/documents";
import {
  createTaskViewSync,
  type TaskViewSyncPorts,
} from "@openducktor/frontend-core/queries/task-view-sync";
import {
  boardEvent,
  eventCursor,
} from "@openducktor/frontend-core/queries/task-view-sync.test-support";
import { type RepoTaskData, taskQueryKeys } from "@openducktor/frontend-core/queries/tasks";
import { workspaceQueryKeys } from "@openducktor/frontend-core/queries/workspace";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

const createPorts = (overrides: Partial<TaskViewSyncPorts> = {}): TaskViewSyncPorts => ({
  listTasks: async () => [createTaskCardFixture({ id: "task-1", status: "open" })],
  loadFreshDocument: async () => ({ markdown: "# Fresh", updatedAt: "2026-04-10T13:10:00.000Z" }),
  ...overrides,
});

const createSync = (ports: TaskViewSyncPorts) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
  test.each(["spec", "plan", "qaReport"] as const)(
    "reads an observed %s write once when its timestamp ties",
    async (section) => {
      const timestamp = "2026-04-10T13:10:00.000Z";
      const card = createTaskCardFixture({ id: "task-1" });
      card.artifactSummary[section] =
        section === "qaReport"
          ? { present: true, updatedAt: timestamp, verdict: "approved" }
          : { present: true, updatedAt: timestamp };
      const payload = { markdown: "# Later commit", updatedAt: timestamp };
      const loadFreshDocument = mock(async () => payload);
      const listTasks = mock(async () => [card]);
      const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
      queryClient.setQueryData(taskQueryKeys.repoData("/repo"), { tasks: [card] });
      const options = taskDocumentQueryOptions(
        queryClient,
        "/repo",
        card.id,
        section,
        loadFreshDocument,
      );
      queryClient.setQueryData(options.queryKey, {
        markdown: "# Earlier commit",
        updatedAt: timestamp,
      });
      const unsubscribe = new QueryObserver(queryClient, options).subscribe(() => {});
      try {
        const event = boardEvent("/repo", [card]);
        event.boardChanges!.artifactChanges = [
          {
            taskId: card.id,
            artifactIds: [workflowArtifactId(card.id, section)],
            removedArtifactIds: [],
          },
        ];
        await sync.reconcileExternalEvent(event, eventCursor(1));
        await sync.reconcileExternalEvent(event, eventCursor(1));
        expect(queryClient.getQueryData<typeof payload>(options.queryKey)).toEqual(payload);
        expect(loadFreshDocument).toHaveBeenCalledTimes(1);
        expect(listTasks).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
        queryClient.clear();
      }
    },
  );

  test.each(["/repo", "/inactive"])(
    "patches complete cards in %s without board or unchanged document reads",
    async (repoPath) => {
      const card = createTaskCardFixture({
        id: "task-1",
        description: "New description",
        status: "blocked",
      });
      const other = createTaskCardFixture({ id: "task-2" });
      const listTasks = mock(async () => []);
      const loadFreshDocument = mock(async () => ({ markdown: "", updatedAt: null }));
      const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
      queryClient.setQueryData(taskQueryKeys.repoData(repoPath), {
        tasks: [createTaskCardFixture({ id: "task-1" }), other],
      });
      queryClient.setQueryData(documentQueryKeys.document(repoPath, "task-1", "spec"), {
        markdown: "",
        updatedAt: null,
      });
      const readObservedTasks = mock(async () => ({ tasks: [] }));
      const unsubscribe = new QueryObserver(queryClient, {
        queryKey: taskQueryKeys.repoData(repoPath),
        queryFn: readObservedTasks,
        staleTime: Infinity,
      }).subscribe(() => {});
      try {
        await sync.reconcileExternalEvent(boardEvent(repoPath, [card]), eventCursor());
        const data = queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData(repoPath))!;
        expect(data.tasks).toContainEqual(card);
        expect(data.tasks).toContainEqual(other);
        expect(listTasks).not.toHaveBeenCalled();
        expect(readObservedTasks).not.toHaveBeenCalled();
        expect(loadFreshDocument).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
      }
    },
  );

  test("refreshes only observed documents with changed summary timestamps", async () => {
    const updatedAt = "2026-04-10T13:10:00.000Z";
    const card = createTaskCardFixture({
      id: "task-1",
      artifactSummary: {
        spec: { present: true, updatedAt },
        plan: { present: true, updatedAt },
        qaReport: { present: false },
      },
    });
    const loadFreshDocument = mock(async (_repo: string, _task: string, _section: string) => ({
      markdown: "# Fresh",
      updatedAt,
    }));
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    const specKey = documentQueryKeys.document("/repo", "task-1", "spec");
    const planKey = documentQueryKeys.document("/repo", "task-1", "plan");
    queryClient.setQueryData(specKey, { markdown: "# Old", updatedAt: null });
    queryClient.setQueryData(planKey, { markdown: "# Old", updatedAt: null });
    const unsubscribe = observeDocument(queryClient, specKey);
    try {
      await sync.reconcileExternalEvent(boardEvent("/repo", [card]), eventCursor());
      expect(loadFreshDocument.mock.calls).toEqual([["/repo", "task-1", "spec"]]);
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(specKey),
      ).toEqual({ markdown: "# Fresh", updatedAt });
      expect(queryClient.getQueryState(planKey)?.isInvalidated).toBe(true);
      await sync.reconcileExternalEvent(boardEvent("/repo", [card]), eventCursor());
      expect(loadFreshDocument).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  test("session-only events leave all board and document reads alone", async () => {
    const listTasks = mock(async () => []);
    const loadFreshDocument = mock(async () => ({ markdown: "", updatedAt: null }));
    const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
    const card = createTaskCardFixture({ id: "task-1" });
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), { tasks: [card] });
    await sync.reconcileExternalEvent(
      { ...boardEvent("/repo", [card]), boardChanges: null },
      eventCursor(),
    );
    expect(queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo"))).toEqual({
      tasks: [card],
    });
    expect(listTasks).not.toHaveBeenCalled();
    expect(loadFreshDocument).not.toHaveBeenCalled();
  });

  test("an older reset event does not reread a newer local document save", async () => {
    const loadFreshDocument = mock(async () => ({ markdown: "", updatedAt: null }));
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    const key = documentQueryKeys.document("/repo", "task-1", "spec");
    const saved = { markdown: "# Saved after reset", updatedAt: "2026-04-10T13:11:00.000Z" };
    queryClient.setQueryData(key, saved);
    const unsubscribe = observeDocument(queryClient, key);
    try {
      await sync.reconcileExternalEvent(
        boardEvent("/repo", [createTaskCardFixture({ id: "task-1" })]),
        eventCursor(),
      );
      expect(queryClient.getQueryData<typeof saved>(key)).toEqual(saved);
      expect(loadFreshDocument).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  test("applies changed cards, deletion, and the closed-task window without deleting hidden task IDs", async () => {
    const { queryClient, sync } = createSync(createPorts());
    const updated = createTaskCardFixture({ id: "updated", availableActions: ["close_task"] });
    const expired = createTaskCardFixture({
      id: "expired",
      status: "closed",
      updatedAt: "2026-04-01T00:00:00Z",
    });
    const closed = createTaskCardFixture({
      id: "closed",
      status: "closed",
      updatedAt: "2026-04-10T13:09:00Z",
    });
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), {
      tasks: [
        expired,
        createTaskCardFixture({ id: "deleted" }),
        createTaskCardFixture({ id: "updated" }),
        closed,
      ],
    });
    queryClient.setQueryData(taskQueryKeys.ids("/repo"), [
      "expired",
      "deleted",
      "updated",
      "closed",
    ]);
    const removedKey = documentQueryKeys.document("/repo", "deleted", "spec");
    queryClient.setQueryData(removedKey, { markdown: "# Old", updatedAt: null });
    const event = boardEvent("/repo", [updated]);
    if (event.kind !== "tasks_updated") throw new Error("Expected update");
    await sync.reconcileExternalEvent(
      { ...event, taskIds: ["updated", "deleted"], removedTaskIds: ["deleted"] },
      eventCursor(),
    );
    expect(queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo"))?.tasks).toEqual([
      updated,
      closed,
    ]);
    expect(queryClient.getQueryData<string[]>(taskQueryKeys.ids("/repo"))).toEqual([
      "expired",
      "updated",
      "closed",
    ]);
    expect(queryClient.getQueryState(removedKey)).toBeUndefined();
  });

  test("does not seed an unread board with a partial event", async () => {
    const { queryClient, sync } = createSync(createPorts());
    await sync.reconcileExternalEvent(
      boardEvent("/repo", [createTaskCardFixture({ id: "task-1" })]),
      eventCursor(),
    );
    expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo"))).toBeUndefined();
  });

  test("does not restore a removed document from a pending first read", async () => {
    const result = deferred<{ markdown: string; updatedAt: string | null }>();
    const loadFreshDocument = mock(async () => ({ markdown: "", updatedAt: null }));
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    const key = documentQueryKeys.document("/repo", "task-1", "spec");
    const read = queryClient.fetchQuery(
      taskDocumentQueryOptions(queryClient, "/repo", "task-1", "spec", () => result.promise),
    );
    await sync.reconcileExternalEvent(
      boardEvent("/repo", [createTaskCardFixture({ id: "task-1" })]),
      eventCursor(),
    );
    result.resolve({ markdown: "# Removed spec", updatedAt: "2026-04-10T13:09:00.000Z" });
    expect(await read).toEqual({ markdown: "", updatedAt: null });
    expect(queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(key)).toEqual({
      markdown: "",
      updatedAt: null,
    });
    expect(loadFreshDocument).not.toHaveBeenCalled();
  });

  test("a restored document supersedes a pending reset without clearing the fresh result", async () => {
    const oldRead = deferred<{ markdown: string; updatedAt: string | null }>();
    const restored = { markdown: "# Restored", updatedAt: "2026-04-10T13:11:00.000Z" };
    const loadFreshDocument = mock(async () => restored);
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    const key = documentQueryKeys.document("/repo", "task-1", "spec");
    const read = queryClient
      .fetchQuery(
        taskDocumentQueryOptions(queryClient, "/repo", "task-1", "spec", () => oldRead.promise),
      )
      .catch(() => undefined);
    const unsubscribe = observeDocument(queryClient, key);
    try {
      await sync.reconcileExternalEvent(
        boardEvent("/repo", [createTaskCardFixture()]),
        eventCursor(),
      );
      const card = createTaskCardFixture({
        artifactSummary: {
          spec: { present: true, updatedAt: restored.updatedAt },
          plan: { present: false },
          qaReport: { present: false },
        },
      });
      await sync.reconcileExternalEvent(
        { ...boardEvent("/repo", [card]), emittedAt: restored.updatedAt },
        eventCursor(),
      );
      oldRead.resolve({ markdown: "# Removed", updatedAt: "2026-04-10T13:09:00.000Z" });
      await read;
      expect(queryClient.getQueryData<typeof restored>(key)).toEqual(restored);
      expect(loadFreshDocument).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });

  test("a save after a pending reset reaches the cache and the imperative reader", async () => {
    const oldRead = deferred<{ markdown: string; updatedAt: string | null }>();
    const { queryClient, sync } = createSync(createPorts());
    const key = documentQueryKeys.document("/repo", "task-1", "spec");
    const read = queryClient.fetchQuery(
      taskDocumentQueryOptions(queryClient, "/repo", "task-1", "spec", () => oldRead.promise),
    );
    await sync.reconcileExternalEvent(
      boardEvent("/repo", [createTaskCardFixture()]),
      eventCursor(),
    );
    const saved = { markdown: "# Saved", updatedAt: "2026-04-10T13:11:00.000Z" };
    queryClient.setQueryData(key, saved);
    oldRead.resolve({ markdown: "# Removed", updatedAt: "2026-04-10T13:09:00.000Z" });
    expect(await read).toEqual(saved);
    expect(queryClient.getQueryData<typeof saved>(key)).toEqual(saved);
    queryClient.clear();
  });

  for (const baseline of ["cached", "pending"] as const) {
    test.each(["spec", "plan", "qaReport"] as const)(
      `an ordinary task edit keeps an unchanged first %s read with a ${baseline} board`,
      async (section) => {
        const result = deferred<{ markdown: string; updatedAt: string | null }>();
        const boardResult = deferred<TaskCard[]>();
        const updatedAt = "2026-04-10T13:09:00.000Z";
        const card = createTaskCardFixture({
          updatedAt,
          artifactSummary: {
            spec: { present: true, updatedAt },
            plan: { present: true, updatedAt },
            qaReport: { present: true, updatedAt, verdict: "approved" },
          },
        });
        const changed = { ...card, title: "Renamed", updatedAt: "2026-04-10T13:10:00.000Z" };
        const other = createTaskCardFixture({ id: "task-2" });
        const loadFreshDocument = mock(() => result.promise);
        const listTasks = mock(() => boardResult.promise);
        const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
        const boardKey = taskQueryKeys.repoData("/repo");
        if (baseline === "cached") queryClient.setQueryData(boardKey, { tasks: [card, other] });
        const boardRead =
          baseline === "pending"
            ? queryClient.fetchQuery({
                queryKey: boardKey,
                queryFn: async () => ({ tasks: await listTasks() }),
              })
            : undefined;
        const options = taskDocumentQueryOptions(
          queryClient,
          "/repo",
          card.id,
          section,
          loadFreshDocument,
        );
        const read = queryClient.fetchQuery(options).then(
          (value) => ({ value }),
          () => ({ cancelled: true }),
        );
        const unsubscribe = new QueryObserver(queryClient, options).subscribe(() => {});
        try {
          const reconciliation = sync.reconcileExternalEvent(
            boardEvent("/repo", [changed]),
            eventCursor(),
          );
          // Let the event reach the pending document before releasing its first read.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const payload = { markdown: "# Existing", updatedAt };
          result.resolve(payload);
          await reconciliation;
          expect(await read).toEqual({ value: payload });
          expect(loadFreshDocument).toHaveBeenCalledTimes(1);
          expect(queryClient.getQueryData<typeof payload>(options.queryKey)).toEqual(payload);
          boardResult.resolve([card, other]);
          await boardRead;
          expect(queryClient.getQueryData<RepoTaskData>(boardKey)?.tasks).toEqual(
            expect.arrayContaining([changed, other]),
          );
          expect(listTasks).toHaveBeenCalledTimes(baseline === "pending" ? 1 : 0);
        } finally {
          boardResult.resolve([card, other]);
          result.resolve({ markdown: "# Existing", updatedAt });
          await boardRead;
          unsubscribe();
          queryClient.clear();
        }
      },
    );
  }

  for (const section of ["spec", "plan", "qaReport"] as const) {
    test.each([
      "older",
      "newer",
      "cache-write",
      "replacement",
      "failure",
      "cancelled",
      "failure-with-data",
    ] as const)(
      `an unknown board baseline preserves first ${section} read ownership across %s`,
      async (change) => {
        let finishRead!: (value: { markdown: string; updatedAt: string | null }) => void;
        let failRead!: (error: Error) => void;
        const firstRead = new Promise<{ markdown: string; updatedAt: string | null }>(
          (resolve, reject) => {
            finishRead = resolve;
            failRead = reject;
          },
        );
        const boardResult = deferred<TaskCard[]>();
        const committedAt = "2026-04-10T13:10:00.000Z";
        const committed = { markdown: "# Committed", updatedAt: committedAt };
        const later = { markdown: "# Later", updatedAt: "2026-04-10T13:11:00.000Z" };
        const initial = { markdown: "# Earlier", updatedAt: "2026-04-10T13:09:00.000Z" };
        const loadFreshDocument = mock<TaskViewSyncPorts["loadFreshDocument"]>(() =>
          Promise.resolve(committed),
        ).mockImplementationOnce(() => firstRead);
        const listTasks = mock(() => boardResult.promise);
        const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
        const boardKey = taskQueryKeys.repoData("/repo");
        const boardRead = queryClient.fetchQuery({
          queryKey: boardKey,
          queryFn: async () => ({ tasks: await listTasks() }),
        });
        const options = taskDocumentQueryOptions(
          queryClient,
          "/repo",
          "task-1",
          section,
          loadFreshDocument,
        );
        const read = queryClient.fetchQuery(options).then(
          (value) => ({ value }),
          (error: Error) => ({ error }),
        );
        const observer = new QueryObserver(queryClient, options);
        const unsubscribe = observer.subscribe(() => {});
        const card = createTaskCardFixture({
          artifactSummary: {
            spec: { present: true, updatedAt: committedAt },
            plan: { present: true, updatedAt: committedAt },
            qaReport: { present: true, updatedAt: committedAt, verdict: "approved" },
          },
        });
        const error = new Error("document read unavailable");
        const completion = sync
          .reconcileExternalEvent(boardEvent("/repo", [card]), eventCursor())
          .then(
            () => null,
            (error: Error) => error,
          );
        try {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (change === "replacement")
            queryClient.removeQueries({ queryKey: options.queryKey, exact: true });
          if (
            change === "replacement" ||
            change === "cache-write" ||
            change === "failure-with-data"
          )
            queryClient.setQueryData(options.queryKey, later);
          if (change === "cancelled")
            await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
          if (change === "failure" || change === "failure-with-data") failRead(error);
          else finishRead(change === "newer" ? later : initial);
          const completed = await completion;
          const failed = change === "failure" || change === "failure-with-data";
          if (change === "cancelled") expect(completed).toBeInstanceOf(CancelledError);
          else expect(completed).toEqual(failed ? error : null);
          const outcome = await read;
          if (change === "failure" || change === "failure-with-data") {
            expect(outcome).toEqual({ error });
            expect(observer.getCurrentResult().error).toEqual(error);
            const cached = queryClient.getQueryData<typeof later>(options.queryKey);
            if (change === "failure-with-data") expect(cached).toEqual(later);
            else expect(cached).toBeUndefined();
          } else if (change === "cancelled") {
            expect(outcome).toHaveProperty("error", expect.any(CancelledError));
            expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
          } else if (change === "replacement") {
            expect(outcome).toHaveProperty("error");
            expect(queryClient.getQueryData<typeof later>(options.queryKey)).toEqual(later);
          } else {
            const older = change === "older";
            const expectedCache = older ? committed : later;
            expect(outcome).toEqual({ value: older ? initial : expectedCache });
            expect(queryClient.getQueryData<typeof committed>(options.queryKey)).toEqual(
              expectedCache,
            );
            expect(observer.getCurrentResult().data).toEqual(expectedCache);
          }
          expect(loadFreshDocument).toHaveBeenCalledTimes(change === "older" ? 2 : 1);
          expect(listTasks).toHaveBeenCalledTimes(1);
        } finally {
          finishRead(initial);
          boardResult.resolve([card]);
          await Promise.all([read, completion, boardRead]);
          unsubscribe();
          queryClient.clear();
        }
      },
    );
  }

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

  test("refreshes tasks when the settings query fails", async () => {
    const listTasks = mock(async () => [createTaskCardFixture({ id: "task-2" })]);
    const { queryClient, sync } = createSync(createPorts({ listTasks }));
    await expect(
      queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.settingsSnapshot(),
        queryFn: async () => {
          throw new Error("settings unavailable");
        },
      }),
    ).rejects.toThrow("settings unavailable");

    await expect(sync.refreshManually("/repo")).resolves.toBeUndefined();
    expect(listTasks).toHaveBeenCalledWith("/repo");
  });

  test("loads repository tasks when the settings query fails", async () => {
    const listTasks = mock(async () => [createTaskCardFixture({ id: "task-2" })]);
    const { queryClient, sync } = createSync(createPorts({ listTasks }));
    await expect(
      queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.settingsSnapshot(),
        queryFn: async () => {
          throw new Error("settings unavailable");
        },
      }),
    ).rejects.toThrow("settings unavailable");

    await expect(sync.loadWorkspace("/repo")).resolves.toBeUndefined();
    expect(listTasks).toHaveBeenCalledWith("/repo");
  });

  test("reconciles snapshots without fetching cached documents that may be deleted", async () => {
    const listTasks = mock(async () => []);
    const loadFreshDocument = mock(async () => {
      throw new Error("task no longer exists");
    });
    const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), { tasks: [] });
    queryClient.setQueryData(documentQueryKeys.document("/repo", "deleted-task", "spec"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    await sync.reconcileStreamSnapshot(["/repo"]);

    expect(loadFreshDocument).not.toHaveBeenCalled();
    expect(listTasks).toHaveBeenCalledWith("/repo");
    expect(
      queryClient.getQueryState(documentQueryKeys.document("/repo", "deleted-task", "spec"))
        ?.isInvalidated,
    ).toBe(true);
  });

  test("refreshes active snapshot artifacts absent from the kanban list", async () => {
    const listTasks = mock(async (): Promise<TaskCard[]> => []);
    const loadFreshDocument = mock(async () => ({
      markdown: "# Updated hidden task",
      updatedAt: "2026-04-10T13:10:00.000Z",
    }));
    const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
    const documentKey = documentQueryKeys.document("/repo", "task-1", "spec");
    queryClient.setQueryData(documentKey, { markdown: "# Stale", updatedAt: null });
    const unsubscribe = observeDocument(queryClient, documentKey);

    try {
      await expect(sync.reconcileStreamSnapshot(["/repo"])).resolves.toEqual({
        taskIdsByRepo: new Map([["/repo", []]]),
        failures: new Map(),
      });

      expect(listTasks).toHaveBeenCalledWith("/repo");
      expect(listTasks).toHaveBeenCalledTimes(1);
      expect(loadFreshDocument).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryData(documentKey)).toEqual({
        markdown: "# Updated hidden task",
        updatedAt: "2026-04-10T13:10:00.000Z",
      });
    } finally {
      unsubscribe();
    }
  });

  test("waits for fresh spec, plan, and QA documents while leaving inactive documents invalidated", async () => {
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
    const activeDocuments = [
      ["spec", documentQueryKeys.document("/repo", "task-1", "spec")],
      ["plan", documentQueryKeys.document("/repo", "task-1", "plan")],
      ["qaReport", documentQueryKeys.document("/repo", "task-1", "qaReport")],
    ] as const;
    const inactiveDocumentKey = documentQueryKeys.document("/repo", "task-2", "spec");
    for (const [, key] of activeDocuments) {
      queryClient.setQueryData(key, { markdown: "# Stale", updatedAt: null });
    }
    queryClient.setQueryData(inactiveDocumentKey, { markdown: "# Stale", updatedAt: null });
    const unsubscribe = activeDocuments.map(([, key]) => observeDocument(queryClient, key));
    let settled = false;

    try {
      const snapshot = sync.reconcileStreamSnapshot(["/repo"]).then(() => {
        settled = true;
      });
      await freshDocumentStarted.promise;

      expect(settled).toBe(false);
      expect(loadFreshDocument).toHaveBeenCalledWith("/repo", "task-1", "spec");
      expect(queryClient.getQueryState(inactiveDocumentKey)?.isInvalidated).toBe(true);

      freshDocument.resolve({ markdown: "# Fresh", updatedAt: "2026-04-10T13:10:00.000Z" });
      await snapshot;

      expect(settled).toBe(true);
      expect(loadFreshDocument).toHaveBeenCalledTimes(3);
      for (const [section, key] of activeDocuments) {
        expect(loadFreshDocument).toHaveBeenCalledWith("/repo", "task-1", section);
        expect(
          queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(key),
        ).toEqual({
          markdown: `# task-1 ${section}`,
          updatedAt: "2026-04-10T13:10:00.000Z",
        });
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
      }
      expect(loadFreshDocument).not.toHaveBeenCalledWith("/repo", "task-2", "spec");
      expect(queryClient.getQueryState(inactiveDocumentKey)?.isInvalidated).toBe(true);
    } finally {
      for (const stopObserving of unsubscribe) stopObserving();
    }
  });

  test("reads every observed document of a snapshot and reports the one that fails", async () => {
    const pendingPlan = deferred<{ markdown: string; updatedAt: string | null }>();
    const planStarted = deferred<void>();
    const readFailure = new Error("spec unavailable");
    const loadFreshDocument = mock(async (_repoPath: string, _taskId: string, section: string) => {
      if (section === "spec") throw readFailure;
      planStarted.resolve();
      return pendingPlan.promise;
    });
    const { queryClient, sync } = createSync(createPorts({ loadFreshDocument }));
    const specKey = documentQueryKeys.document("/repo", "task-1", "spec");
    const planKey = documentQueryKeys.document("/repo", "task-1", "plan");
    for (const key of [specKey, planKey]) {
      queryClient.setQueryData(key, { markdown: "# Stale", updatedAt: null });
    }
    const unsubscribe = [specKey, planKey].map((key) => observeDocument(queryClient, key));
    let settled = false;

    try {
      const snapshot = sync.reconcileStreamSnapshot(["/repo"]).then((result) => {
        settled = true;
        return result;
      });
      await planStarted.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);

      const fresh = { markdown: "# Fresh plan", updatedAt: "2026-04-10T13:10:00.000Z" };
      pendingPlan.resolve(fresh);
      // The task IDs still reconcile the sessions. The notification names the workspace.
      expect(await snapshot).toEqual({
        taskIdsByRepo: new Map([["/repo", ["task-1"]]]),
        failures: new Map([["/repo", readFailure]]),
      });
      expect(queryClient.getQueryState(specKey)).toMatchObject({
        status: "error",
        error: readFailure,
      });
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(planKey),
      ).toEqual(fresh);
    } finally {
      for (const stopObserving of unsubscribe) stopObserving();
    }
  });

  test("invalidates snapshot documents of a workspace that is not open without fetching its tasks", async () => {
    const listTasks = mock(async () => []);
    const loadFreshDocument = mock(async () => ({ markdown: "# Snapshot", updatedAt: null }));
    const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), { tasks: [] });
    queryClient.setQueryData(documentQueryKeys.document("/inactive", "task-1", "plan"), {
      markdown: "# Stale",
      updatedAt: null,
    });

    await sync.reconcileStreamSnapshot(["/repo"]);

    expect(listTasks).toHaveBeenCalledWith("/repo");
    expect(listTasks).not.toHaveBeenCalledWith("/inactive");
    expect(loadFreshDocument).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(documentQueryKeys.document("/inactive", "task-1", "plan"))
        ?.isInvalidated,
    ).toBe(true);
  });

  test("cancels snapshot document and closed workspace task queries before invalidating", async () => {
    const { queryClient, sync } = createSync(createPorts());
    const calls = recordQueryOperations(queryClient);
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), { tasks: [] });
    queryClient.setQueryData(taskQueryKeys.repoData("/inactive"), { tasks: [] });
    queryClient.setQueryData(documentQueryKeys.document("/repo", "task-1", "spec"), {
      markdown: "# Active stale",
      updatedAt: null,
    });
    queryClient.setQueryData(documentQueryKeys.document("/inactive", "task-1", "spec"), {
      markdown: "# Inactive stale",
      updatedAt: null,
    });

    await sync.reconcileStreamSnapshot(["/repo"]);

    expect(calls.indexOf("cancel:documents")).toBeLessThan(calls.indexOf("invalidate:documents"));
    expect(calls.indexOf("cancel:tasks")).toBeLessThan(calls.indexOf("invalidate:tasks"));
  });

  test("reconciles the task list and observed documents of every open workspace", async () => {
    const listTasks = mock(async (repoPath: string) => [
      createTaskCardFixture({ id: `${repoPath}-task` }),
    ]);
    const loadFreshDocument = mock(async () => ({
      markdown: "# Fresh",
      updatedAt: "2026-04-10T13:10:00.000Z",
    }));
    const { queryClient, sync } = createSync(createPorts({ listTasks, loadFreshDocument }));
    queryClient.setQueryData(taskQueryKeys.repoData("/repo-b"), { tasks: [] });
    const documentKey = documentQueryKeys.document("/repo-b", "/repo-b-task", "spec");
    queryClient.setQueryData(documentKey, { markdown: "# Stale", updatedAt: null });
    const unsubscribe = observeDocument(queryClient, documentKey);

    try {
      await expect(sync.reconcileStreamSnapshot(["/repo-a", "/repo-b"])).resolves.toEqual({
        taskIdsByRepo: new Map([
          ["/repo-a", ["/repo-a-task"]],
          ["/repo-b", ["/repo-b-task"]],
        ]),
        failures: new Map(),
      });

      expect(listTasks.mock.calls).toEqual([["/repo-a"], ["/repo-b"]]);
      expect(
        queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo-b"))?.tasks,
      ).toEqual([createTaskCardFixture({ id: "/repo-b-task" })]);
      expect(loadFreshDocument).toHaveBeenCalledWith("/repo-b", "/repo-b-task", "spec");
    } finally {
      unsubscribe();
    }
  });

  test("keeps a failed snapshot task read in its own workspace through later events", async () => {
    const readFailure = new Error("task store unavailable");
    const listTasks = mock(async (repoPath: string) => {
      if (repoPath === "/repo-b") throw readFailure;
      return [createTaskCardFixture({ id: "task-a" })];
    });
    const { queryClient, sync } = createSync(createPorts({ listTasks }));
    const beforeGap = [createTaskCardFixture({ id: "deleted-during-gap" })];
    queryClient.setQueryData(taskQueryKeys.repoData("/repo-b"), { tasks: beforeGap });

    await expect(sync.reconcileStreamSnapshot(["/repo-a", "/repo-b"])).resolves.toEqual({
      taskIdsByRepo: new Map([["/repo-a", ["task-a"]]]),
      failures: new Map([["/repo-b", readFailure]]),
    });
    // The list from before the gap cannot take a later change as current.
    await sync.reconcileExternalEvent(
      boardEvent("/repo-b", [createTaskCardFixture({ id: "task-b" })]),
      eventCursor(),
    );

    expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo-b"))).toMatchObject({
      status: "error",
      error: readFailure,
      data: { tasks: beforeGap },
    });
  });

  test("keeps applying events to a current list after a failed manual refresh", async () => {
    const { queryClient, sync } = createSync(
      createPorts({
        listTasks: async () => {
          throw new Error("task store busy");
        },
      }),
    );
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), {
      tasks: [createTaskCardFixture({ id: "task-1", title: "Before" })],
    });
    await expect(sync.refreshManually("/repo")).rejects.toThrow("task store busy");

    const changed = createTaskCardFixture({ id: "task-1", title: "Changed" });
    await sync.reconcileExternalEvent(boardEvent("/repo", [changed]), eventCursor());

    expect(queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo"))?.tasks).toEqual([
      changed,
    ]);
  });

  test("reads the lists of every open workspace again after a retention change", async () => {
    const listTasks = mock(async (repoPath: string) => [
      createTaskCardFixture({ id: `${repoPath}-task` }),
    ]);
    const { queryClient, sync } = createSync(createPorts({ listTasks }));
    for (const repoPath of ["/repo-a", "/repo-b", "/closed"]) {
      queryClient.setQueryData(taskQueryKeys.repoData(repoPath), { tasks: [] });
    }

    await sync.refreshAfterTaskRetentionChange(["/repo-a", "/repo-b"]);

    expect(listTasks.mock.calls).toEqual([["/repo-a"], ["/repo-b"]]);
    expect(
      queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo-b"))?.tasks,
    ).toEqual([createTaskCardFixture({ id: "/repo-b-task" })]);
    expect(queryClient.getQueryState(taskQueryKeys.repoData("/closed"))?.isInvalidated).toBe(true);
  });

  test("drops the task lists and documents of a released workspace", async () => {
    const { queryClient, sync } = createSync(createPorts());
    queryClient.setQueryData(taskQueryKeys.repoData("/closed"), { tasks: [] });
    queryClient.setQueryData(taskQueryKeys.ids("/closed"), ["task-1"]);
    queryClient.setQueryData(documentQueryKeys.document("/closed", "task-1", "plan"), {
      markdown: "# Plan",
      updatedAt: null,
    });
    queryClient.setQueryData(taskQueryKeys.repoData("/open"), { tasks: [] });

    await sync.releaseWorkspace("/closed");

    expect(queryClient.getQueryState(taskQueryKeys.repoData("/closed"))).toBeUndefined();
    expect(queryClient.getQueryState(taskQueryKeys.ids("/closed"))).toBeUndefined();
    expect(
      queryClient.getQueryState(documentQueryKeys.document("/closed", "task-1", "plan")),
    ).toBeUndefined();
    expect(queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/open"))).toEqual({
      tasks: [],
    });

    await sync.reconcileExternalEvent(
      boardEvent("/closed", [createTaskCardFixture({ id: "task-1" })]),
      eventCursor(),
    );
    expect(queryClient.getQueryState(taskQueryKeys.repoData("/closed"))).toBeUndefined();
  });

  test("releases a workspace at once while its task read is pending", async () => {
    const pendingRead = deferred<TaskCard[]>();
    const readStarted = deferred<void>();
    const listTasks = mock(async () => {
      readStarted.resolve();
      return pendingRead.promise;
    });
    const { queryClient, sync } = createSync(createPorts({ listTasks }));
    const load = sync.loadWorkspace("/closed").then(
      () => null,
      (error: Error) => error,
    );
    await readStarted.promise;
    // Queued behind the pending read.
    const snapshot = sync.reconcileStreamSnapshot(["/closed"]);

    await sync.releaseWorkspace("/closed");

    expect(queryClient.getQueryState(taskQueryKeys.repoData("/closed"))).toBeUndefined();
    expect(await load).toBeInstanceOf(CancelledError);
    // The release superseded the queued snapshot read, so it reports neither tasks nor a failure.
    expect(await snapshot).toEqual({ taskIdsByRepo: new Map(), failures: new Map() });

    pendingRead.resolve([createTaskCardFixture({ id: "late" })]);
    await Promise.resolve();
    expect(listTasks).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(taskQueryKeys.repoData("/closed"))).toBeUndefined();

    // A load requested after the release reads the workspace again.
    await sync.loadWorkspace("/closed");
    expect(listTasks).toHaveBeenCalledTimes(2);
  });

  test("keeps the list of a failed retention reload incomplete through later events", async () => {
    const tasks = [createTaskCardFixture({ id: "open-task", title: "Before" })];
    let failReads = true;
    const listTasks = mock(async () => {
      if (failReads) throw new Error("task store busy");
      return tasks;
    });
    const { queryClient, sync } = createSync(createPorts({ listTasks }));
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), { tasks });

    await sync.refreshAfterTaskRetentionChange(["/repo"]);
    failReads = false;
    await sync.reconcileExternalEvent(
      boardEvent("/repo", [createTaskCardFixture({ id: "open-task", title: "Edited" })]),
      eventCursor(),
    );

    expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo"))).toMatchObject({
      status: "error",
      data: { tasks },
    });
    await sync.loadWorkspace("/repo");
    expect(listTasks).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo"))?.status).toBe("success");
  });
});
