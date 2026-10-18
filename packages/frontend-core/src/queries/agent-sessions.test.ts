import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, TaskAgentSessions } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  agentSessionListQueryOptions,
  agentSessionQueryKeys,
  createAgentSessionListLiveSync,
  loadAgentSessionListFromQuery,
  loadAgentSessionListsFromQuery,
  refreshAgentSessionLists,
  removeAgentSessionListQueries,
  retryAgentSessionListQueries,
  updateAgentSessionListQuery,
} from "./agent-sessions";
import { createLiveSnapshotEnvelope } from "../test-support/agent-session-live-fixture";

const sessionFixture: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  startedAt: "2026-03-22T12:00:00.000Z",
  selectedModel: null,
};

type BatchRead = (repoPath: string, taskIds: string[]) => Promise<TaskAgentSessions[]>;

const emptyLists: BatchRead = async (_repoPath, taskIds) =>
  taskIds.map((taskId) => ({ taskId, agentSessions: [] }));

const createReadPort = (read: BatchRead = emptyLists) => ({
  agentSessionsListForTasks: mock(read),
});

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const listKey = (taskId: string, repoPath = "/repo") =>
  agentSessionQueryKeys.list(repoPath, taskId);

const waitForCondition = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Expected the condition to become true.");
};

describe("agent session list reads", () => {
  test("reads that start together share one request for each workspace", async () => {
    const queryClient = createQueryClient();
    const readPort = createReadPort();

    await Promise.all([
      loadAgentSessionListsFromQuery(queryClient, "/repo", [" task-2 ", "task-1", "", "task-2"], {
        readPort,
      }),
      loadAgentSessionListFromQuery(queryClient, "/repo", "task-3", { readPort }),
      loadAgentSessionListFromQuery(queryClient, "/other-repo", "task-1", { readPort }),
    ]);

    expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([
      ["/repo", ["task-1", "task-2", "task-3"]],
      ["/other-repo", ["task-1"]],
    ]);
  });

  test("a workspace has one request in progress, and later reads share the next request", async () => {
    const queryClient = createQueryClient();
    const firstRead = Promise.withResolvers<TaskAgentSessions[]>();
    const readPort = createReadPort(async (repoPath, taskIds) =>
      readPort.agentSessionsListForTasks.mock.calls.length === 1
        ? firstRead.promise
        : emptyLists(repoPath, taskIds),
    );

    const first = loadAgentSessionListFromQuery(queryClient, "/repo", "task-1", { readPort });
    await waitForCondition(() => readPort.agentSessionsListForTasks.mock.calls.length === 1);
    const later = [
      loadAgentSessionListFromQuery(queryClient, "/repo", "task-2", { readPort }),
      loadAgentSessionListFromQuery(queryClient, "/repo", "task-3", { readPort }),
    ];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);

    firstRead.resolve([{ taskId: "task-1", agentSessions: [sessionFixture] }]);
    expect(await first).toEqual([sessionFixture]);
    await Promise.all(later);

    expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([
      ["/repo", ["task-1"]],
      ["/repo", ["task-2", "task-3"]],
    ]);
  });

  const invalidResponses: [string, TaskAgentSessions[], string][] = [
    ["omits a requested task", [], 'Batch session response omitted task "task-1".'],
    [
      "returns a task more than once",
      [
        { taskId: "task-1", agentSessions: [] },
        { taskId: "task-1", agentSessions: [] },
      ],
      'Batch session response included task "task-1" more than once.',
    ],
    [
      "returns an unexpected task",
      [
        { taskId: "task-1", agentSessions: [] },
        { taskId: "task-2", agentSessions: [] },
      ],
      'Batch session response included unexpected task "task-2".',
    ],
  ];
  test.each(invalidResponses)(
    "a batch response that %s fails the list reads",
    async (_case, response, message) => {
      const queryClient = createQueryClient();
      queryClient.setQueryData(listKey("task-1"), [sessionFixture]);
      const readPort = createReadPort(async () => response);

      await expect(
        loadAgentSessionListFromQuery(queryClient, "/repo", "task-1", {
          forceFresh: true,
          readPort,
        }),
      ).rejects.toThrow(message);

      const state = queryClient.getQueryState(listKey("task-1"));
      expect(state?.status).toBe("error");
      expect(state?.data).toEqual([sessionFixture]);
    },
  );

  test("a host failure fails every list read of the request with its cause", async () => {
    const queryClient = createQueryClient();
    const readPort = createReadPort(async () => {
      throw new Error("Task store is unavailable.");
    });

    const results = await Promise.allSettled(
      ["task-1", "task-2"].map((taskId) =>
        loadAgentSessionListFromQuery(queryClient, "/repo", taskId, { readPort }),
      ),
    );

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
    for (const taskId of ["task-1", "task-2"]) {
      expect(queryClient.getQueryState(listKey(taskId))?.error?.message).toBe(
        "Task store is unavailable.",
      );
    }
  });

  test("loads read only missing and invalidated lists", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(listKey("cached"), [sessionFixture]);
    queryClient.setQueryData(listKey("invalidated"), []);
    await queryClient.invalidateQueries({ queryKey: listKey("invalidated"), refetchType: "none" });
    const readPort = createReadPort();

    const lists = await loadAgentSessionListsFromQuery(
      queryClient,
      "/repo",
      ["cached", "invalidated", "missing"],
      { readPort },
    );

    expect(lists).toEqual({ cached: [sessionFixture], invalidated: [], missing: [] });
    expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([
      ["/repo", ["invalidated", "missing"]],
    ]);
    expect(await loadAgentSessionListsFromQuery(queryClient, "/repo", [" "], { readPort })).toEqual(
      {},
    );
    expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
  });

  test("a forced load joins the read already in progress", async () => {
    const queryClient = createQueryClient();
    const readPort = createReadPort();

    await Promise.all([
      queryClient.fetchQuery(agentSessionListQueryOptions("/repo", "task-1", readPort)),
      loadAgentSessionListsFromQuery(queryClient, "/repo", ["task-1"], {
        forceFresh: true,
        readPort,
      }),
    ]);

    expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
  });

  test("explicit retry reads only failed, invalidated, and missing lists", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(listKey("cached"), [sessionFixture]);
    queryClient.setQueryData(listKey("invalidated"), []);
    await queryClient.invalidateQueries({ queryKey: listKey("invalidated"), refetchType: "none" });
    await loadAgentSessionListFromQuery(queryClient, "/repo", "failed", {
      readPort: createReadPort(async () => {
        throw new Error("read failed");
      }),
    }).catch(() => undefined);
    const readPort = createReadPort();

    await retryAgentSessionListQueries(
      queryClient,
      "/repo",
      ["cached", "failed", "invalidated", "missing"],
      readPort,
    );

    expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([
      ["/repo", ["failed", "invalidated", "missing"]],
    ]);
    expect(queryClient.getQueryState(listKey("failed"))?.status).toBe("success");
  });

  test("a committed list completes a read in progress without another request", async () => {
    const queryClient = createQueryClient();
    const older = Promise.withResolvers<TaskAgentSessions[]>();
    const readPort = createReadPort(() => older.promise);
    const loading = loadAgentSessionListsFromQuery(queryClient, "/repo", ["task-1"], { readPort });
    await waitForCondition(() => readPort.agentSessionsListForTasks.mock.calls.length === 1);
    const updated = { ...sessionFixture, lastActivityAt: Date.parse("2026-10-04T10:00:00Z") };

    updateAgentSessionListQuery(queryClient, "/repo", {
      taskId: "task-1",
      agentSessions: [updated],
    });
    older.resolve([{ taskId: "task-1", agentSessions: [sessionFixture] }]);

    expect(await loading).toEqual({ "task-1": [updated] });
    expect(queryClient.getQueryData<AgentSessionRecord[]>(listKey("task-1"))).toEqual([updated]);
    expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
  });

  test("consecutive committed updates during a read keep the newest list", async () => {
    const queryClient = createQueryClient();
    const older = Promise.withResolvers<TaskAgentSessions[]>();
    const readPort = createReadPort(() => older.promise);
    const loading = loadAgentSessionListFromQuery(queryClient, "/repo", "task-1", { readPort });
    await waitForCondition(() => readPort.agentSessionsListForTasks.mock.calls.length === 1);
    const first = { ...sessionFixture, externalSessionId: "update-1" };
    const second = { ...sessionFixture, externalSessionId: "update-2" };

    updateAgentSessionListQuery(queryClient, "/repo", { taskId: "task-1", agentSessions: [first] });
    updateAgentSessionListQuery(queryClient, "/repo", {
      taskId: "task-1",
      agentSessions: [second],
    });
    older.resolve([{ taskId: "task-1", agentSessions: [sessionFixture] }]);

    expect(await loading).toEqual([second]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryClient.getQueryData<AgentSessionRecord[]>(listKey("task-1"))).toEqual([second]);
    expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
  });

  test("a task change waits for the current read of a pending imperative load", async () => {
    const queryClient = createQueryClient();
    const older = Promise.withResolvers<TaskAgentSessions[]>();
    const current = { ...sessionFixture, externalSessionId: "current" };
    const readPort = createReadPort(async (_repoPath, taskIds) =>
      readPort.agentSessionsListForTasks.mock.calls.length === 1
        ? older.promise
        : taskIds.map((taskId) => ({ taskId, agentSessions: [current] })),
    );
    const loading = loadAgentSessionListFromQuery(queryClient, "/repo", "task-1", { readPort });
    await waitForCondition(() => readPort.agentSessionsListForTasks.mock.calls.length === 1);

    let refreshed = false;
    const refreshing = refreshAgentSessionLists(queryClient, "/repo", ["task-1"]).then(
      (ownershipChanged) => {
        refreshed = true;
        return ownershipChanged;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshed).toBe(false);

    older.resolve([{ taskId: "task-1", agentSessions: [sessionFixture] }]);

    expect(await refreshing).toEqual(["task-1"]);
    expect(await loading).toEqual([current]);
    expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(listKey("task-1"))?.fetchStatus).toBe("idle");
  });

  // Query stores a read result some microtasks after the host response. Each offset places the
  // newer work at another point in that interval.
  for (let microtasks = 0; microtasks <= 6; microtasks += 1) {
    test(`a change ${microtasks} microtasks after the response reads current records`, async () => {
      const queryClient = createQueryClient();
      const older = Promise.withResolvers<TaskAgentSessions[]>();
      const current = { ...sessionFixture, externalSessionId: "current" };
      const readPort = createReadPort(async (_repoPath, taskIds) =>
        readPort.agentSessionsListForTasks.mock.calls.length === 1
          ? older.promise
          : taskIds.map((taskId) => ({ taskId, agentSessions: [current] })),
      );
      const stopObserving = new QueryObserver(
        queryClient,
        agentSessionListQueryOptions("/repo", "task-1", readPort),
      ).subscribe(() => {});
      try {
        await waitForCondition(() => readPort.agentSessionsListForTasks.mock.calls.length === 1);
        older.resolve([{ taskId: "task-1", agentSessions: [sessionFixture] }]);
        for (let tick = 0; tick < microtasks; tick += 1) await Promise.resolve();

        await refreshAgentSessionLists(queryClient, "/repo", ["task-1"]);

        expect(queryClient.getQueryData<AgentSessionRecord[]>(listKey("task-1"))).toEqual([
          current,
        ]);
        expect(queryClient.getQueryState(listKey("task-1"))?.isInvalidated).toBe(false);
        expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(2);
      } finally {
        stopObserving();
      }
    });

    test(`a committed update ${microtasks} microtasks after the response stays stored`, async () => {
      const queryClient = createQueryClient();
      const older = Promise.withResolvers<TaskAgentSessions[]>();
      const committed = { ...sessionFixture, externalSessionId: "committed" };
      const readPort = createReadPort(() => older.promise);
      const loading = loadAgentSessionListFromQuery(queryClient, "/repo", "task-1", { readPort });
      await waitForCondition(() => readPort.agentSessionsListForTasks.mock.calls.length === 1);
      older.resolve([{ taskId: "task-1", agentSessions: [sessionFixture] }]);
      for (let tick = 0; tick < microtasks; tick += 1) await Promise.resolve();

      updateAgentSessionListQuery(queryClient, "/repo", {
        taskId: "task-1",
        agentSessions: [committed],
      });

      // A load that completed before the update keeps the list it read.
      expect([[sessionFixture], [committed]]).toContainEqual(await loading);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(queryClient.getQueryData<AgentSessionRecord[]>(listKey("task-1"))).toEqual([
        committed,
      ]);
      expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
    });
  }

  for (let microtasks = 0; microtasks <= 6; microtasks += 1) {
    test(`a change ${microtasks} microtasks after the response of an unobserved load reads again`, async () => {
      const queryClient = createQueryClient();
      const older = Promise.withResolvers<TaskAgentSessions[]>();
      const current = { ...sessionFixture, externalSessionId: "current" };
      const readPort = createReadPort(async (_repoPath, taskIds) =>
        readPort.agentSessionsListForTasks.mock.calls.length === 1
          ? older.promise
          : taskIds.map((taskId) => ({ taskId, agentSessions: [current] })),
      );
      const loading = loadAgentSessionListFromQuery(queryClient, "/repo", "task-1", { readPort });
      await waitForCondition(() => readPort.agentSessionsListForTasks.mock.calls.length === 1);
      older.resolve([{ taskId: "task-1", agentSessions: [sessionFixture] }]);
      for (let tick = 0; tick < microtasks; tick += 1) await Promise.resolve();
      const pendingAtChange =
        queryClient.getQueryState(listKey("task-1"))?.fetchStatus === "fetching";

      await refreshAgentSessionLists(queryClient, "/repo", ["task-1"]);
      const loaded = await loading;

      const state = queryClient.getQueryState<AgentSessionRecord[]>(listKey("task-1"));
      const reads = readPort.agentSessionsListForTasks.mock.calls.length;
      // A read in progress at the change keeps its need for current records.
      if (pendingAtChange) expect(reads).toBe(2);
      if (reads === 2) {
        expect(loaded).toEqual([current]);
        expect(state?.data).toEqual([current]);
        expect(state?.isInvalidated).toBe(false);
      } else {
        // The load completed first. Its list stays stale until a view needs it.
        expect(reads).toBe(1);
        expect(state?.isInvalidated).toBe(true);
      }
    });
  }

  test("a deleted observed list stays empty without a read on live reconnection", async () => {
    const queryClient = createQueryClient();
    const readPort = createReadPort(async (_repoPath, taskIds) => {
      if (taskIds.includes("deleted")) throw new Error("Task not found: deleted");
      return emptyLists("/repo", taskIds);
    });
    queryClient.setQueryData(listKey("deleted"), [sessionFixture]);
    queryClient.setQueryData(listKey("surviving"), []);
    const stops = ["deleted", "surviving"].map((taskId) =>
      new QueryObserver(
        queryClient,
        agentSessionListQueryOptions("/repo", taskId, readPort),
      ).subscribe(() => {}),
    );
    const syncLists = createAgentSessionListLiveSync(queryClient);
    const connectionSnapshot = createLiveSnapshotEnvelope({
      sessions: [],
      sequence: 0,
      isConnectionSnapshot: true,
    });
    try {
      await removeAgentSessionListQueries(queryClient, "/repo", ["deleted"]);
      syncLists(connectionSnapshot);
      syncLists(connectionSnapshot);
      await waitForCondition(() => readPort.agentSessionsListForTasks.mock.calls.length === 1);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(readPort.agentSessionsListForTasks.mock.calls).toEqual([["/repo", ["surviving"]]]);
      expect(queryClient.getQueryState(listKey("deleted"))?.status).toBe("success");
      expect(queryClient.getQueryData<AgentSessionRecord[]>(listKey("deleted"))).toEqual([]);
      expect(queryClient.getQueryState(listKey("surviving"))?.status).toBe("success");
    } finally {
      for (const stop of stops) stop();
    }
  });

  test("removing a task keeps an observed list empty after its older read returns", async () => {
    const queryClient = createQueryClient();
    const older = Promise.withResolvers<TaskAgentSessions[]>();
    const readPort = createReadPort(() => older.promise);
    const stopObserving = new QueryObserver(
      queryClient,
      agentSessionListQueryOptions("/repo", "task-1", readPort),
    ).subscribe(() => {});
    try {
      await waitForCondition(() => readPort.agentSessionsListForTasks.mock.calls.length === 1);

      await removeAgentSessionListQueries(queryClient, "/repo", ["task-1"]);
      older.resolve([{ taskId: "task-1", agentSessions: [sessionFixture] }]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(queryClient.getQueryData<AgentSessionRecord[]>(listKey("task-1"))).toEqual([]);
      expect(queryClient.getQueryState(listKey("task-1"))?.fetchStatus).toBe("idle");
      expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
    } finally {
      stopObserving();
    }
  });

  test("a later live connection snapshot rereads the cached lists of its repository", async () => {
    const queryClient = createQueryClient();
    const refreshed = { ...sessionFixture, externalSessionId: "external-2" };
    const readPort = createReadPort(async (_repoPath, taskIds) =>
      taskIds.map((taskId) => ({
        taskId,
        agentSessions:
          readPort.agentSessionsListForTasks.mock.calls.length === 1
            ? [sessionFixture]
            : [refreshed],
      })),
    );
    const stopObserving = new QueryObserver(
      queryClient,
      agentSessionListQueryOptions("/repo", "task-1", readPort),
    ).subscribe(() => {});
    const syncLists = createAgentSessionListLiveSync(queryClient);
    const connectionSnapshot = createLiveSnapshotEnvelope({
      sessions: [],
      sequence: 0,
      isConnectionSnapshot: true,
    });
    try {
      await waitForCondition(() => queryClient.getQueryData(listKey("task-1")) !== undefined);
      syncLists(connectionSnapshot);
      syncLists(createLiveSnapshotEnvelope({ sessions: [], sequence: 1 }));
      expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(1);

      syncLists(connectionSnapshot);
      await waitForCondition(
        () =>
          queryClient.getQueryData<AgentSessionRecord[]>(listKey("task-1"))?.[0]
            ?.externalSessionId === "external-2",
      );
      expect(readPort.agentSessionsListForTasks).toHaveBeenCalledTimes(2);
    } finally {
      stopObserving();
    }
  });
});
