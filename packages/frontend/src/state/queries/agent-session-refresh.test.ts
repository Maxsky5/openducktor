import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  ExternalTaskSyncEvent,
  TaskAgentSessions,
} from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createAgentSessionViewSync } from "./agent-session-view-sync";
import { agentSessionQueryKeys, loadAgentSessionListsFromQuery } from "./agent-sessions";

const record = (id: string): AgentSessionRecord => ({
  externalSessionId: id,
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  role: "build",
  startedAt: "2026-10-04T12:00:00Z",
  selectedModel: null,
});
const event = (
  taskIds: string[],
  removedTaskIds: string[] = [],
  repoPath = "/repo",
): ExternalTaskSyncEvent => ({
  kind: "tasks_updated",
  eventId: crypto.randomUUID(),
  repoPath,
  taskIds,
  removedTaskIds,
  statusChanges: [],
  taskSnapshots: [],
  emittedAt: "2026-10-04T12:00:00Z",
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture(taskIds: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const records = new Map(
    taskIds.map((id, index) => [
      id,
      index % 3 ? [record(`${id}-first`), record(`${id}-second`)] : [],
    ]),
  );
  const single = mock(async (_repo: string, id: string) => records.get(id)!);
  const batch = mock(async (_repo: string, ids: string[]): Promise<TaskAgentSessions[]> =>
    ids.map((taskId) => ({ taskId, agentSessions: records.get(taskId)! })),
  );
  const port = {
    agentSessionsListForTasks: batch,
    tasksExistingIds: async (_repo: string, ids: string[]) => ids.filter((id) => records.has(id)),
  };
  const unsubscribes = taskIds.map((taskId) =>
    new QueryObserver(queryClient, {
      queryKey: agentSessionQueryKeys.list("/repo", taskId),
      queryFn: () => single("/repo", taskId),
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {}),
  );
  const live = mock(async (_repo: string) => {});
  const remove = mock((_repo: string, _ids: string[]) => {});
  const sync = createAgentSessionViewSync({
    queryClient,
    readPort: port,
    refreshLiveSessions: live,
    removeTaskSessions: remove,
  });
  return {
    queryClient,
    records,
    batch,
    single,
    port,
    live,
    remove,
    sync,
    dispose: () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      queryClient.clear();
    },
  };
}

describe("change-driven session refresh", () => {
  for (const size of [1, 100]) {
    test(`refreshes ${size} active task lists in one host request with complete host records`, async () => {
      const ids = Array.from({ length: size }, (_, i) => `task-${i}`);
      const f = fixture(ids);
      try {
        await f.sync.reconcileExternalEvent(event([...ids, ids[0]!]));
        expect(f.batch.mock.calls.length + f.single.mock.calls.length).toBe(1);
        for (const taskId of ids)
          expect(
            f.queryClient.getQueryData<AgentSessionRecord[]>(
              agentSessionQueryKeys.list("/repo", taskId),
            ),
          ).toEqual(f.records.get(taskId));
        expect(f.live).toHaveBeenCalledTimes(size === 1 ? 0 : 1);
      } finally {
        f.dispose();
      }
    });
  }

  test("combines nearby changes, reconciles both owners, and awaits one shared live refresh", async () => {
    const f = fixture(["a", "b"]);
    const liveRelease = deferred<void>();
    f.live.mockImplementation(() => liveRelease.promise);
    f.records.set("a", []);
    f.records.set("b", [record("moved")]);
    let completed = false;
    try {
      const first = f.sync.reconcileExternalEvent(event(["a"]));
      const second = f.sync.reconcileExternalEvent(event(["b", "a"]));
      const completion = Promise.all([first, second]).then(() => {
        completed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 65));
      expect(f.batch).toHaveBeenCalledTimes(1);
      expect(f.live).toHaveBeenCalledTimes(1);
      expect(completed).toBe(false);
      expect(
        f.queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "a")),
      ).toEqual([]);
      expect(
        f.queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "b")),
      ).toEqual([record("moved")]);
      liveRelease.resolve();
      await completion;
    } finally {
      liveRelease.resolve();
      f.dispose();
    }
  });

  test("serializes concurrent reads and carries an old baseline to the newer change", async () => {
    const f = fixture(["a", "b"]);
    const started = deferred<void>();
    const release = deferred<void>();
    let active = 0;
    let maxActive = 0;
    f.batch.mockImplementation(async (_repo, ids) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const result = ids.map((taskId) => ({ taskId, agentSessions: f.records.get(taskId)! }));
      if (f.batch.mock.calls.length === 1) {
        started.resolve();
        await release.promise;
      }
      active -= 1;
      return result;
    });
    try {
      const baseline = loadAgentSessionListsFromQuery(f.queryClient, "/repo", ["a", "b"], {
        forceFresh: true,
        readPort: f.port,
      });
      await started.promise;
      f.records.set("a", [record("new")]);
      const first = f.sync.reconcileExternalEvent(event(["a"]));
      const second = f.sync.reconcileExternalEvent(event(["a"]));
      release.resolve();
      const [result] = await Promise.all([baseline, first, second]);
      expect(maxActive).toBe(1);
      expect(f.batch).toHaveBeenCalledTimes(2);
      expect(f.batch.mock.calls[1]?.[1]).toEqual(["a"]);
      expect(result.a).toEqual([record("new")]);
      expect(
        f.queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "a")),
      ).toEqual([record("new")]);
    } finally {
      release.resolve();
      f.dispose();
    }
  });

  test("carries a membership change when a newer event arrives during the query commit", async () => {
    const f = fixture(["a"]);
    f.records.set("a", [record("created")]);
    let newer: Promise<void> | null = null;
    const unsubscribe = f.queryClient.getQueryCache().subscribe((notification) => {
      if (
        notification.type === "updated" &&
        notification.action.type === "success" &&
        newer === null
      ) {
        newer = f.sync.reconcileExternalEvent(event(["a"]));
      }
    });
    try {
      await f.sync.reconcileExternalEvent(event(["a"]));
      await newer;
      expect(f.batch).toHaveBeenCalledTimes(2);
      expect(f.live).toHaveBeenCalledTimes(1);
      expect(
        f.queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "a")),
      ).toEqual([record("created")]);
    } finally {
      unsubscribe();
      f.dispose();
    }
  });

  test("requires a later live refresh when membership changes during an older live refresh", async () => {
    const f = fixture(["a"]);
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const firstRelease = deferred<void>();
    const secondRelease = deferred<void>();
    f.live.mockImplementation(() => {
      if (f.live.mock.calls.length === 1) {
        firstStarted.resolve();
        return firstRelease.promise;
      }
      secondStarted.resolve();
      return secondRelease.promise;
    });
    f.records.set("a", [record("first")]);
    try {
      const first = f.sync.reconcileExternalEvent(event(["a"]));
      await firstStarted.promise;
      f.records.set("a", [record("second")]);
      let completed = false;
      const second = f.sync.reconcileExternalEvent(event(["a"])).then(() => {
        completed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 65));
      expect(f.batch).toHaveBeenCalledTimes(2);
      expect(f.live).toHaveBeenCalledTimes(1);
      firstRelease.resolve();
      await first;
      await secondStarted.promise;
      expect(completed).toBe(false);
      expect(f.live).toHaveBeenCalledTimes(2);
      secondRelease.resolve();
      await second;
      expect(
        f.queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "a")),
      ).toEqual([record("second")]);
    } finally {
      firstRelease.resolve();
      secondRelease.resolve();
      f.dispose();
    }
  });

  test("a confirmed deletion completes earlier change work without waiting for an obsolete response", async () => {
    const f = fixture(["a"]);
    const started = deferred<void>();
    const release = deferred<void>();
    f.batch.mockImplementation(async () => {
      started.resolve();
      await release.promise;
      return [{ taskId: "a", agentSessions: [record("late")] }];
    });
    try {
      const first = f.sync.reconcileExternalEvent(event(["a"]));
      await started.promise;
      await Promise.all([first, f.sync.reconcileExternalEvent(event(["a"], ["a"]))]);
      expect(
        f.queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "a")),
      ).toEqual([]);
      release.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        f.queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "a")),
      ).toEqual([]);
      expect(f.batch).toHaveBeenCalledTimes(1);
      expect(f.live).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      f.dispose();
    }
  });

  test("leaves inactive records stale and keeps workspace request scopes separate", async () => {
    const f = fixture(["a"]);
    f.queryClient.setQueryData(agentSessionQueryKeys.list("/other", "a"), [record("other")]);
    try {
      await f.sync.reconcileExternalEvent(event(["a"], [], "/other"));
      expect(f.batch).not.toHaveBeenCalled();
      expect(
        f.queryClient.getQueryState(agentSessionQueryKeys.list("/other", "a"))?.isInvalidated,
      ).toBe(true);
      await f.sync.reconcileExternalEvent(event(["a"]));
      expect(f.batch.mock.calls[0]?.[0]).toBe("/repo");
      expect(
        f.queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/other", "a")),
      ).toEqual([record("other")]);
    } finally {
      f.dispose();
    }
  });
});
