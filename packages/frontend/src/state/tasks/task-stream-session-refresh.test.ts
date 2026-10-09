import { expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  ExternalTaskSyncEvent,
  TaskAgentSessions,
  TaskEventCursor,
} from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import type { TaskStreamFrame } from "@/lib/shell-bridge";
import { createAgentSessionViewSync } from "../queries/agent-session-view-sync";
import { agentSessionQueryKeys, loadAgentSessionListsFromQuery } from "../queries/agent-sessions";
import { createTaskStreamController } from "./task-stream-controller";

for (const obsoleteResult of ["success", "failure"] as const) {
  test(`acknowledges superseded changes while ${obsoleteResult} responses keep arriving`, async () => {
    const f = fixture(["a"]);
    const live = deferred<void>();
    f.refreshLive.mockImplementation(() => live.promise);
    let loaded = false;
    try {
      const load = loadAgentSessionListsFromQuery(f.queryClient, "/repo", ["a"], {
        forceFresh: true,
        readPort: f.port,
      }).then((result) => {
        loaded = true;
        return result;
      });
      await f.batchCount(1);
      await f.controller.start();
      f.change(0, ["a"]);
      for (let sequence = 1; sequence <= 3; sequence += 1) {
        f.change(sequence, ["a"]);
        await f.acknowledged(sequence);
        expect(loaded).toBe(false);
        expect(f.records("a")).toEqual([]);
        if (obsoleteResult === "failure") f.batches[sequence - 1]!.reject(new Error("obsolete"));
        else f.batches[sequence - 1]!.resolve([sessions("a", "obsolete")]);
        await f.batchCount(sequence + 1);
      }
      f.batches[3]!.resolve([sessions("a", "current")]);
      expect(await load).toEqual({ a: [record("current")] });
      await waitFor(() => expect(f.refreshLive).toHaveBeenCalledTimes(1), { timeout: 500 });
      expect(f.acks).toEqual([0, 1, 2]);
      live.resolve();
      await f.acknowledged(4);
      expect(f.acks).toEqual([0, 1, 2, 3]);
      expect(f.maxActive()).toBe(1);
      expect(f.listeners).toHaveLength(1);
      expect(f.degraded).not.toHaveBeenCalled();
    } finally {
      live.resolve();
      await f.dispose();
    }
  });
}

test("a partially superseded change awaits its other task and live refresh", async () => {
  const f = fixture(["a", "b"]);
  const firstLive = deferred<void>();
  const secondLive = deferred<void>();
  f.refreshLive.mockImplementation(() =>
    f.refreshLive.mock.calls.length === 1 ? firstLive.promise : secondLive.promise,
  );
  try {
    await f.controller.start();
    f.change(0, ["a", "b"]);
    await f.batchCount(1);
    f.change(1, ["a"]);
    expect(f.acks).toEqual([]);
    f.batches[0]!.resolve([sessions("a", "obsolete-a"), sessions("b", "current-b")]);
    await f.batchCount(2);
    await waitFor(() => expect(f.refreshLive).toHaveBeenCalledTimes(1), { timeout: 500 });
    expect(f.records("a")).toEqual([]);
    expect(f.records("b")).toEqual([record("current-b")]);
    expect(f.acks).toEqual([]);
    firstLive.resolve();
    await f.acknowledged(1);
    expect(f.acks).toEqual([0]);
    f.batches[1]!.resolve([sessions("a", "current-a")]);
    await waitFor(() => expect(f.refreshLive).toHaveBeenCalledTimes(2), { timeout: 500 });
    expect(f.acks).toEqual([0]);
    secondLive.resolve();
    await f.acknowledged(2);
    expect(f.acks).toEqual([0, 1]);
    expect(f.records("a")).toEqual([record("current-a")]);
    expect(f.maxActive()).toBe(1);
    expect(f.degraded).not.toHaveBeenCalled();
  } finally {
    firstLive.resolve();
    secondLive.resolve();
    await f.dispose();
  }
});

test("a failed latest refresh stays visible and unacknowledged after its predecessor completes", async () => {
  const f = fixture(["a"]);
  const failure = new Error("Cannot read current session records");
  try {
    await f.controller.start();
    f.change(0, ["a"]);
    await f.batchCount(1);
    f.change(1, ["a"]);
    await f.acknowledged(1);
    f.batches[0]!.resolve([sessions("a", "obsolete")]);
    await f.batchCount(2);
    f.batches[1]!.reject(failure);
    await waitFor(() => expect(f.listeners).toHaveLength(2), { timeout: 500 });
    expect(f.acks).toEqual([0]);
    expect(f.queryClient.getQueryState(agentSessionQueryKeys.list("/repo", "a"))?.error).toBe(
      failure,
    );
    expect(f.degraded).toHaveBeenCalledWith(failure);
    expect(f.batches).toHaveLength(2);
    expect(f.refreshLive).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

test("a replacement query owns its change after the previous query is cancelled", async () => {
  const f = fixture(["a"]);
  let unsubscribe = () => {};
  try {
    await f.controller.start();
    f.change(0, ["a"]);
    await f.batchCount(1);
    const queryKey = agentSessionQueryKeys.list("/repo", "a");
    f.queryClient.removeQueries({ queryKey, exact: true });
    unsubscribe = new QueryObserver(f.queryClient, {
      queryKey,
      queryFn: async () => [],
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {});
    f.change(1, ["a"]);
    await f.acknowledged(1);
    f.batches[0]!.reject(new Error("obsolete transport failure"));
    await f.batchCount(2);
    f.batches[1]!.resolve([sessions("a", "current")]);
    await f.acknowledged(2);
    expect(f.acks).toEqual([0, 1]);
    expect(f.records("a")).toEqual([record("current")]);
    expect(f.degraded).not.toHaveBeenCalled();
    expect(f.listeners).toHaveLength(1);
    expect(f.maxActive()).toBe(1);
  } finally {
    unsubscribe();
    await f.dispose();
  }
});

function fixture(taskIds: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const unsubscribes = taskIds.map((taskId) =>
    new QueryObserver(queryClient, {
      queryKey: agentSessionQueryKeys.list("/repo", taskId),
      queryFn: async () => [],
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {}),
  );
  const batches: ReturnType<typeof deferred<TaskAgentSessions[]>>[] = [];
  let active = 0;
  let maxActive = 0;
  const port = {
    tasksExistingIds: async (_repo: string, ids: string[]) =>
      ids.filter((id) => taskIds.includes(id)),
    agentSessionsListForTasks: async (_repoPath: string, _ids: string[]) => {
      const batch = deferred<TaskAgentSessions[]>();
      batches.push(batch);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await batch.promise;
      } finally {
        active -= 1;
      }
    },
  };
  const refreshLive = mock(async (_repoPath: string) => {});
  const sync = createAgentSessionViewSync({
    queryClient,
    readPort: port,
    removeTaskSessions: () => {},
    refreshLiveSessions: refreshLive,
  });
  const listeners: ((frame: TaskStreamFrame) => void)[] = [];
  const acks: number[] = [];
  const degraded = mock(() => {});
  const controller = createTaskStreamController({
    transport: {
      subscribeTaskStream: async (_input, listener) => {
        listeners.push(listener);
        return {
          subscriptionId: `stream-${listeners.length}`,
          acknowledge: async (cursor: TaskEventCursor) => {
            acks.push(cursor.sequence);
          },
          unsubscribe: async () => {},
        };
      },
    },
    taskViewSync: {
      loadWorkspace: async () => {},
      refreshManually: async () => {},
      refreshAfterTaskRetentionChange: async () => {},
      refreshAfterLocalMutation: async () => {},
      reconcileExternalEvent: async () => {},
      reconcileStreamSnapshot: async () => taskIds,
    },
    agentSessionViewSync: sync,
    getActiveRepoPath: () => "/repo",
    onDegraded: degraded,
  });
  return {
    queryClient,
    controller,
    port,
    batches,
    refreshLive,
    acks,
    listeners,
    degraded,
    maxActive: () => maxActive,
    records: (taskId: string) =>
      queryClient.getQueryData(agentSessionQueryKeys.list("/repo", taskId)),
    batchCount: (count: number) =>
      waitFor(() => expect(batches).toHaveLength(count), { timeout: 500 }),
    acknowledged: (count: number) =>
      waitFor(() => expect(acks).toHaveLength(count), { timeout: 500 }),
    change: (sequence: number, ids: string[]) => {
      const event: ExternalTaskSyncEvent = {
        kind: "tasks_updated",
        eventId: `event-${sequence}`,
        repoPath: "/repo",
        taskIds: ids,
        removedTaskIds: [],
        statusChanges: [],
        taskSnapshots: [],
        emittedAt: "2026-10-04T12:00:00Z",
      };
      listeners.at(-1)!({
        type: "change",
        cursor: { epoch: "11111111-1111-4111-8111-111111111111", sequence },
        event,
      });
    },
    dispose: async () => {
      for (const batch of batches) batch.resolve([]);
      await controller.stop();
      for (const unsubscribe of unsubscribes) unsubscribe();
      queryClient.clear();
    },
  };
}

const record = (id: string): AgentSessionRecord => ({
  externalSessionId: id,
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  role: "build",
  startedAt: "2026-10-04T12:00:00Z",
  selectedModel: null,
});

const sessions = (taskId: string, id: string): TaskAgentSessions => ({
  taskId,
  agentSessions: [record(id)],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
