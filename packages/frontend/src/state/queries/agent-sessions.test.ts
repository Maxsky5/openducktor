import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionLiveSnapshotEnvelope,
  AgentSessionRecord,
  TaskAgentSessions,
} from "@openducktor/contracts";
import { isCancelledError, QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  agentSessionListQueryOptions,
  agentSessionQueryKeys,
  createAgentSessionListLiveSync,
  invalidateAgentSessionListQuery,
  loadAgentSessionListFromQuery,
  loadAgentSessionListsFromQuery,
  refreshAgentSessionListQuery,
  removeAgentSessionListQueries,
  retryAgentSessionListQueries,
  updateAgentSessionListQuery,
} from "./agent-sessions";
import { dropWorkspaceQueries } from "./workspace";

const record: AgentSessionRecord = {
  externalSessionId: "session",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-10-04T12:00:00Z",
  selectedModel: null,
};
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const waitForCondition = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Expected the condition to become true.");
};

describe("canonical agent session reads", () => {
  test("a later live connection snapshot rereads the cached lists of its repository", async () => {
    const queryClient = new QueryClient();
    const refreshed = { ...record, externalSessionId: "external-2" };
    let reads = 0;
    const agentSessionsListForTasks = mock(async (_repo: string, taskIds: string[]) => {
      reads += 1;
      return taskIds.map((taskId) => ({
        taskId,
        agentSessions: reads === 1 ? [record] : [refreshed],
      }));
    });
    const observer = new QueryObserver(
      queryClient,
      agentSessionListQueryOptions(queryClient, "/repo", "task-1", { agentSessionsListForTasks }),
    );
    const stopObserving = observer.subscribe(() => {});
    const syncLists = createAgentSessionListLiveSync(queryClient);
    const connectionSnapshot: AgentSessionLiveSnapshotEnvelope = {
      type: "snapshot",
      repoPath: "/repo",
      sessions: [],
      sequence: 0,
      isConnectionSnapshot: true,
    };
    try {
      await observer.refetch();
      syncLists(connectionSnapshot);
      syncLists({ type: "snapshot", repoPath: "/repo", sessions: [], sequence: 1 });
      expect(agentSessionsListForTasks).toHaveBeenCalledTimes(1);

      syncLists(connectionSnapshot);
      await waitForCondition(() => agentSessionsListForTasks.mock.calls.length === 2);
      await waitForCondition(
        () =>
          queryClient.getQueryData<AgentSessionRecord[]>(
            agentSessionQueryKeys.list("/repo", "task-1"),
          )?.[0]?.externalSessionId === "external-2",
      );
    } finally {
      stopObserving();
      queryClient.clear();
    }
  });

  test("a committed list completes a batch that joined its older read", async () => {
    const queryClient = client();
    const older = Promise.withResolvers<TaskAgentSessions[]>();
    const started = Promise.withResolvers<void>();
    const batch = mock(async (_repo: string, ids: string[]) => {
      if (ids.includes("task-1")) {
        started.resolve();
        return older.promise;
      }
      return ids.map((taskId) => ({ taskId, agentSessions: [] }));
    });
    const readPort = { agentSessionsListForTasks: batch };
    try {
      const initialRead = loadAgentSessionListFromQuery(queryClient, "/repo", "task-1", {
        readPort,
      });
      await started.promise;
      const loading = loadAgentSessionListsFromQuery(queryClient, "/repo", ["task-1", "task-2"], {
        readPort,
      });
      updateAgentSessionListQuery(queryClient, "/repo", {
        taskId: "task-1",
        agentSessions: [record],
      });
      older.resolve([{ taskId: "task-1", agentSessions: [] }]);
      expect(await initialRead).toEqual([record]);
      expect(await loading).toEqual({ "task-1": [record], "task-2": [] });
      expect(batch).toHaveBeenCalledTimes(2);
      expect(batch).toHaveBeenNthCalledWith(1, "/repo", ["task-1"]);
      expect(batch).toHaveBeenNthCalledWith(2, "/repo", ["task-2"]);
    } finally {
      older.resolve([{ taskId: "task-1", agentSessions: [] }]);
      queryClient.clear();
    }
  });

  test.each(["invalidate", "remove", "failure"] as const)(
    "a joined read does not hide %s without a committed replacement",
    async (change) => {
      const queryClient = client();
      const older = Promise.withResolvers<TaskAgentSessions[]>();
      const started = Promise.withResolvers<void>();
      const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
      queryClient.setQueryData(queryKey, []);
      const readPort = {
        agentSessionsListForTasks: () => {
          started.resolve();
          return older.promise;
        },
      };
      try {
        const reading = queryClient
          .fetchQuery({
            ...agentSessionListQueryOptions(queryClient, "/repo", "task-1", readPort),
            staleTime: 0,
          })
          .catch(() => undefined);
        await started.promise;
        const loading = loadAgentSessionListsFromQuery(queryClient, "/repo", ["task-1"], {
          readPort,
          forceFresh: true,
        }).catch((error) => error);
        if (change === "invalidate")
          await invalidateAgentSessionListQuery(queryClient, "/repo", "task-1");
        else if (change === "remove") {
          await removeAgentSessionListQueries(queryClient, "/repo", ["task-1"]);
          queryClient.setQueryData(queryKey, [record]);
        } else older.reject(new Error("Host read failed"));
        const error = await loading;
        expect(
          change === "failure"
            ? error instanceof Error && error.message === "Host read failed"
            : isCancelledError(error),
        ).toBe(true);
        older.resolve([{ taskId: "task-1", agentSessions: [] }]);
        await reading;
      } finally {
        older.resolve([{ taskId: "task-1", agentSessions: [] }]);
        queryClient.clear();
      }
    },
  );

  for (const cached of [false, true]) {
    test(`a saved activity update replaces an older ${cached ? "forced" : "initial"} read without another host read`, async () => {
      const queryClient = client();
      const started = deferred<void>();
      const old = deferred<TaskAgentSessions[]>();
      const read = mock(() => {
        started.resolve();
        return old.promise;
      });
      const key = agentSessionQueryKeys.list("/repo", "task-1");
      if (cached) queryClient.setQueryData(key, [record]);
      const updated = { ...record, lastActivityAt: Date.parse("2026-10-04T13:00:00Z") };
      try {
        const reading = loadAgentSessionListFromQuery(queryClient, "/repo", "task-1", {
          readPort: { agentSessionsListForTasks: read },
          forceFresh: cached,
        });
        await started.promise;
        updateAgentSessionListQuery(queryClient, "/repo", {
          taskId: "task-1",
          agentSessions: [updated],
        });
        expect(await reading).toEqual([updated]);
        old.resolve([{ taskId: "task-1", agentSessions: [record] }]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(queryClient.getQueryData<AgentSessionRecord[]>(key)).toEqual([updated]);
        expect(read).toHaveBeenCalledTimes(1);
      } finally {
        old.resolve([{ taskId: "task-1", agentSessions: [record] }]);
        queryClient.clear();
      }
    });
  }

  test("shares initial, single, multi-task, and forced reads through canonical queries", async () => {
    const queryClient = client();
    const batch = mock(async (_repo: string, ids: string[]) =>
      ids.map((taskId) => ({ taskId, agentSessions: taskId === "a" ? [record] : [] })),
    );
    const readPort = { agentSessionsListForTasks: batch };
    try {
      const [single, multiple] = await Promise.all([
        loadAgentSessionListFromQuery(queryClient, "/repo", "a", { readPort }),
        loadAgentSessionListsFromQuery(queryClient, "/repo", ["b", "a", "a", " "], {
          readPort,
          forceFresh: true,
        }),
      ]);
      expect(batch).toHaveBeenCalledTimes(1);
      expect(batch).toHaveBeenCalledWith("/repo", ["a", "b"]);
      expect(single).toEqual([record]);
      expect(multiple).toEqual({ a: [record], b: [] });
      expect(
        await loadAgentSessionListsFromQuery(queryClient, "/repo", ["a", "b"], { readPort }),
      ).toEqual(multiple);
      expect(batch).toHaveBeenCalledTimes(1);
      await invalidateAgentSessionListQuery(queryClient, "/repo", "a");
      await loadAgentSessionListsFromQuery(queryClient, "/repo", ["a", "b"], { readPort });
      expect(batch.mock.calls[1]?.[1]).toEqual(["a"]);
    } finally {
      queryClient.clear();
    }
  });

  for (const [name, response, error] of [
    ["missing", [{ taskId: "a", agentSessions: [] }], 'omitted task "b"'],
    [
      "duplicate",
      [
        { taskId: "a", agentSessions: [] },
        { taskId: "a", agentSessions: [] },
      ],
      "more than once",
    ],
    ["unexpected", [{ taskId: "wrong", agentSessions: [] }], "unexpected task"],
  ] as const) {
    test(`rejects a ${name} result for the whole batch, retains records, and supports explicit recovery`, async () => {
      const queryClient = client();
      const batch = mock(async (): Promise<TaskAgentSessions[]> =>
        response.map((entry) => ({ ...entry, agentSessions: [...entry.agentSessions] })),
      );
      const readPort = { agentSessionsListForTasks: batch };
      for (const taskId of ["a", "b"])
        queryClient.setQueryData(agentSessionQueryKeys.list("/repo", taskId), [record]);
      try {
        await expect(
          loadAgentSessionListsFromQuery(queryClient, "/repo", ["a", "b"], {
            readPort,
            forceFresh: true,
          }),
        ).rejects.toThrow(error);
        for (const taskId of ["a", "b"]) {
          const key = agentSessionQueryKeys.list("/repo", taskId);
          expect(queryClient.getQueryState(key)?.status).toBe("error");
          expect(queryClient.getQueryData<AgentSessionRecord[]>(key)).toEqual([record]);
        }
        await expect(
          loadAgentSessionListsFromQuery(queryClient, "/repo", ["a", "b"], { readPort }),
        ).rejects.toThrow(error);
        expect(batch).toHaveBeenCalledTimes(1);
        batch.mockImplementation(async () => [
          { taskId: "a", agentSessions: [record] },
          { taskId: "b", agentSessions: [] },
        ]);
        await retryAgentSessionListQueries(queryClient, "/repo", ["a", "b"], readPort);
        expect(batch).toHaveBeenCalledTimes(2);
        expect(queryClient.getQueryState(agentSessionQueryKeys.list("/repo", "b"))?.status).toBe(
          "success",
        );
        expect(
          queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "b")),
        ).toEqual([]);
      } finally {
        queryClient.clear();
      }
    });
  }

  test("holds the workspace transport slot until a cancelled host request settles", async () => {
    const queryClient = client();
    const started = deferred<void>();
    const released = deferred<void>();
    let active = 0;
    let maximum = 0;
    const batch = mock(async (_repo: string, ids: string[]) => {
      active += 1;
      maximum = Math.max(maximum, active);
      if (batch.mock.calls.length === 1) {
        started.resolve();
        await released.promise;
      }
      active -= 1;
      return ids.map((taskId) => ({ taskId, agentSessions: [record] }));
    });
    const readPort = { agentSessionsListForTasks: batch };
    try {
      const first = loadAgentSessionListFromQuery(queryClient, "/repo", "a", { readPort });
      const firstOutcome = first.then(
        () => "loaded",
        () => "cancelled",
      );
      await started.promise;
      await removeAgentSessionListQueries(queryClient, "/repo", ["a"]);
      const second = refreshAgentSessionListQuery(queryClient, "/repo", "b", readPort);
      await Promise.resolve();
      expect(batch).toHaveBeenCalledTimes(1);
      released.resolve();
      await second;
      expect(await firstOutcome).toBe("cancelled");
      expect(maximum).toBe(1);
      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "a")),
      ).toBeUndefined();
      expect(
        await loadAgentSessionListFromQuery(queryClient, "/repo", "a", {
          readPort,
          forceFresh: true,
        }),
      ).toEqual([]);
      expect(batch).toHaveBeenCalledTimes(2);
    } finally {
      released.resolve();
      queryClient.clear();
    }
  });

  for (const obsoleteOutcome of ["success", "failure"] as const) {
    test(`a replacement workspace query reads current records after an obsolete ${obsoleteOutcome}`, async () => {
      const queryClient = client();
      const started = deferred<void>();
      const release = deferred<void>();
      const newer = { ...record, externalSessionId: "newer" };
      let active = 0;
      let maximum = 0;
      const batch = mock(async (_repo: string, ids: string[]) => {
        active += 1;
        maximum = Math.max(maximum, active);
        try {
          const obsolete = batch.mock.calls.length === 1;
          if (obsolete) {
            started.resolve();
            await release.promise;
            if (obsoleteOutcome === "failure") throw new Error("Obsolete host failure");
          }
          return ids.map((taskId) => ({ taskId, agentSessions: [obsolete ? record : newer] }));
        } finally {
          active -= 1;
        }
      });
      const readPort = { agentSessionsListForTasks: batch };
      const key = agentSessionQueryKeys.list("/repo", "a");
      try {
        const first = loadAgentSessionListFromQuery(queryClient, "/repo", "a", { readPort });
        const firstOutcome = first.then(
          () => false,
          (cause) => isCancelledError(cause),
        );
        await started.promise;
        dropWorkspaceQueries(queryClient, { repoPath: "/repo", workspaceId: "workspace" });
        const replacement = loadAgentSessionListFromQuery(queryClient, "/repo", "a", {
          readPort,
          forceFresh: true,
        });
        expect(await firstOutcome).toBe(true);
        expect(batch).toHaveBeenCalledTimes(1);
        expect(queryClient.getQueryData<AgentSessionRecord[]>(key)).toBeUndefined();
        release.resolve();

        expect(await replacement).toEqual([newer]);
        expect(queryClient.getQueryData<AgentSessionRecord[]>(key)).toEqual([newer]);
        expect(queryClient.getQueryState(key)?.status).toBe("success");
        expect(batch).toHaveBeenCalledTimes(2);
        expect(maximum).toBe(1);
      } finally {
        release.resolve();
        queryClient.clear();
      }
    });
  }

  test("an older response preserves a newer authoritative cache replacement", async () => {
    const queryClient = client();
    const started = deferred<void>();
    const release = deferred<void>();
    const newer = { ...record, externalSessionId: "newer" };
    const readPort = {
      agentSessionsListForTasks: async () => {
        started.resolve();
        await release.promise;
        return [{ taskId: "a", agentSessions: [record] }];
      },
    };
    const key = agentSessionQueryKeys.list("/repo", "a");
    try {
      const load = loadAgentSessionListFromQuery(queryClient, "/repo", "a", { readPort });
      await started.promise;
      queryClient.setQueryData(key, [newer]);
      release.resolve();
      expect(await load).toEqual([newer]);
      expect(queryClient.getQueryData<AgentSessionRecord[]>(key)).toEqual([newer]);
    } finally {
      release.resolve();
      queryClient.clear();
    }
  });

  test("explicit recovery retries only failed, invalidated, and missing records", async () => {
    const queryClient = client();
    const batch = mock(async (_repo: string, ids: string[]) =>
      ids.map((taskId) => ({ taskId, agentSessions: [] })),
    );
    const readPort = { agentSessionsListForTasks: batch };
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "healthy"), [record]);
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "stale"), [record]);
    await invalidateAgentSessionListQuery(queryClient, "/repo", "stale");
    try {
      await retryAgentSessionListQueries(
        queryClient,
        "/repo",
        ["healthy", "stale", "missing"],
        readPort,
      );
      expect(batch).toHaveBeenCalledWith("/repo", ["missing", "stale"]);
      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "healthy"),
        ),
      ).toEqual([record]);
    } finally {
      queryClient.clear();
    }
  });
});
