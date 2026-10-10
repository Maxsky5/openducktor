import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, ExternalTaskSyncEvent } from "@openducktor/contracts";
import { CancelledError, QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  agentSessionQueryKeys,
  type AgentSessionReadPort,
  updateAgentSessionListQuery,
} from "./agent-sessions";
import { createAgentSessionViewSync } from "./agent-session-view-sync";

const event = (): ExternalTaskSyncEvent => ({
  kind: "tasks_updated",
  eventId: "event-session-create",
  repoPath: "/repo",
  taskIds: ["task-1"],
  removedTaskIds: [],
  statusChanges: [],
  taskSnapshots: [{ id: "task-1", title: "task-1", status: "open" }],
  emittedAt: "2026-09-03T20:00:00.000Z",
});

const unusedReadPort: AgentSessionReadPort = {
  agentSessionsList: async () => {
    throw new Error("unexpected session list");
  },
  agentSessionsListForTasks: async () => {
    throw new Error("unexpected session batch");
  },
};

type TestReadPort = AgentSessionReadPort;

const readPort = (overrides: Partial<TestReadPort> = {}): TestReadPort => ({
  ...unusedReadPort,
  ...overrides,
});

describe("AgentSessionViewSync", () => {
  test.each([
    { change: "a committed session update", committed: true },
    { change: "an external cancellation", committed: false },
  ])("handles $change during a task-event refresh", async ({ committed }) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const readStarted = Promise.withResolvers<void>();
    const staleRead = Promise.withResolvers<AgentSessionRecord[]>();
    const freshRecords: AgentSessionRecord[] = [
      {
        externalSessionId: "new-builder",
        role: "build",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        startedAt: "2026-09-03T20:00:00.000Z",
        selectedModel: null,
      },
    ];
    const loadSessions = mock(() => {
      readStarted.resolve();
      return staleRead.promise;
    });
    const refreshLiveSessions = mock(async () => undefined);
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey,
      queryFn: loadSessions,
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: readPort(),
      removeTaskSessions: () => {},
      refreshLiveSessions,
    });

    try {
      const refresh = sync.reconcileExternalEvent(event());
      const result = refresh.then(
        () => ({ ok: true }),
        (error: CancelledError) => ({ ok: false, error }),
      );
      await readStarted.promise;
      if (committed) {
        updateAgentSessionListQuery(queryClient, "/repo", {
          taskId: "task-1",
          agentSessions: freshRecords,
        });
        expect(await result).toEqual({ ok: true });
        expect(refreshLiveSessions).toHaveBeenCalledWith("/repo");
      } else {
        await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false });
        expect(await result).toEqual({ ok: false, error: expect.any(CancelledError) });
        expect(refreshLiveSessions).not.toHaveBeenCalled();
      }
      staleRead.resolve([]);
      await staleRead.promise;

      expect(queryClient.getQueryData<AgentSessionRecord[]>(queryKey)).toEqual(
        committed ? freshRecords : [],
      );
      expect(loadSessions).toHaveBeenCalledTimes(1);
    } finally {
      staleRead.resolve([]);
      unsubscribe();
      queryClient.clear();
    }
  });

  test("refreshes live sessions when task session ownership changes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const freshRecords = [
      {
        externalSessionId: "session-from-other-client",
        role: "build" as const,
        runtimeKind: "opencode" as const,
        workingDirectory: "/repo/worktree",
        startedAt: "2026-09-03T20:00:00.000Z",
        selectedModel: null,
      },
    ];
    const loadSessions = mock(async () => freshRecords);
    const refreshLiveSessions = mock(async () => undefined);
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey,
      queryFn: loadSessions,
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: readPort(),
      removeTaskSessions: () => {},
      refreshLiveSessions,
    });

    try {
      await sync.reconcileExternalEvent(event());

      expect(queryClient.getQueryData<typeof freshRecords>(queryKey)).toEqual(freshRecords);
      expect(refreshLiveSessions).toHaveBeenCalledWith("/repo");

      await sync.reconcileExternalEvent({
        ...event(),
        eventId: "event-task-only-change",
        emittedAt: "2026-09-03T20:01:00.000Z",
      });

      expect(loadSessions).toHaveBeenCalledTimes(2);
      expect(refreshLiveSessions).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  test("reports session record refresh failures", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const loadSessions = mock(async () => {
      throw new Error("session records unavailable");
    });
    const refreshLiveSessions = mock(async () => undefined);
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey,
      queryFn: loadSessions,
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: readPort(),
      removeTaskSessions: () => {},
      refreshLiveSessions,
    });

    try {
      await expect(sync.reconcileExternalEvent(event())).rejects.toThrow(
        "session records unavailable",
      );
      expect(refreshLiveSessions).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  test("clears session state without rereading a deleted task", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const loadSessions = mock(async () => []);
    const removeTaskSessions = mock((_repoPath: string, _taskIds: string[]) => {});
    const refreshLiveSessions = mock(async () => undefined);
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey,
      queryFn: loadSessions,
      initialData: [
        {
          externalSessionId: "deleted-task-session",
          role: "build" as const,
          runtimeKind: "opencode" as const,
          workingDirectory: "/repo/worktree",
          startedAt: "2026-09-03T20:00:00.000Z",
          selectedModel: null,
        },
      ],
      staleTime: Infinity,
    }).subscribe(() => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: readPort(),
      removeTaskSessions,
      refreshLiveSessions,
    });

    try {
      await sync.reconcileExternalEvent({
        kind: "tasks_updated",
        eventId: "event-session-delete",
        repoPath: "/repo",
        taskIds: ["task-1"],
        removedTaskIds: ["task-1"],
        statusChanges: [],
        taskSnapshots: [],
        emittedAt: "2026-09-03T20:00:00.000Z",
      });

      expect(queryClient.getQueryData<unknown[]>(queryKey)).toEqual([]);
      expect(loadSessions).not.toHaveBeenCalled();
      expect(removeTaskSessions).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(refreshLiveSessions).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  test("reloads task session records and live sessions for a stream snapshot", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sessionQueryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const loadSessions = mock(async () => []);
    const loadSessionBatch = mock(async () => [{ taskId: "task-1", agentSessions: [] }]);
    const refreshLiveSessions = mock(async () => undefined);
    const unsubscribeSessions = new QueryObserver(queryClient, {
      queryKey: sessionQueryKey,
      queryFn: loadSessions,
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: readPort({
        agentSessionsList: loadSessions,
        agentSessionsListForTasks: loadSessionBatch,
      }),
      removeTaskSessions: () => {},
      refreshLiveSessions,
    });

    try {
      await sync.reconcileStreamSnapshot("/repo", ["task-1"]);

      expect(loadSessionBatch).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(refreshLiveSessions).toHaveBeenCalledWith("/repo");
    } finally {
      unsubscribeSessions();
    }
  });

  test("drops stale session scopes before it reloads a stream snapshot", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const staleActiveSessionKey = agentSessionQueryKeys.list("/repo", "deleted-task");
    const currentActiveSessionKey = agentSessionQueryKeys.list("/repo", "current-task");
    const inactiveSessionKey = agentSessionQueryKeys.list("/other-repo", "other-task");
    queryClient.setQueryData(staleActiveSessionKey, [{ externalSessionId: "stale-session" }]);
    queryClient.setQueryData(inactiveSessionKey, [{ externalSessionId: "inactive-session" }]);
    const removeTaskSessions = mock((_repoPath: string, _taskIds: string[]) => {});
    const loadSessionBatch = mock(async () => [{ taskId: "current-task", agentSessions: [] }]);
    const refreshLiveSessions = mock(async () => undefined);
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: readPort({
        agentSessionsList: async () => [],
        agentSessionsListForTasks: loadSessionBatch,
      }),
      removeTaskSessions,
      refreshLiveSessions,
    });

    await sync.reconcileStreamSnapshot("/repo", ["current-task"]);

    expect(queryClient.getQueryData(staleActiveSessionKey)).toBeUndefined();
    expect(queryClient.getQueryData(inactiveSessionKey)).toBeUndefined();
    expect(queryClient.getQueryData<unknown[]>(currentActiveSessionKey)).toEqual([]);
    expect(removeTaskSessions).toHaveBeenCalledWith("/repo", ["deleted-task"]);
    expect(loadSessionBatch).toHaveBeenCalledWith("/repo", ["current-task"]);
    expect(refreshLiveSessions).toHaveBeenCalledWith("/repo");
  });

  test("refetches observed session lists of an inactive workspace after a stream snapshot", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observedKey = agentSessionQueryKeys.list("/other-repo", "observed-task");
    const unobservedKey = agentSessionQueryKeys.list("/other-repo", "unobserved-task");
    queryClient.setQueryData(unobservedKey, [{ externalSessionId: "unobserved-session" }]);
    const freshRecords = [
      {
        externalSessionId: "fresh-session",
        role: "build" as const,
        runtimeKind: "opencode" as const,
        workingDirectory: "/other-repo",
        startedAt: "2026-09-03T20:00:00.000Z",
        selectedModel: null,
      },
    ];
    const loadObservedSessions = mock(async () => freshRecords);
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey: observedKey,
      queryFn: loadObservedSessions,
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: readPort({ agentSessionsListForTasks: async () => [] }),
      removeTaskSessions: () => {},
      refreshLiveSessions: async () => undefined,
    });

    try {
      await sync.reconcileStreamSnapshot("/repo", []);

      expect(loadObservedSessions).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryData<typeof freshRecords>(observedKey)).toEqual(freshRecords);
      expect(queryClient.getQueryData(unobservedKey)).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });
});
