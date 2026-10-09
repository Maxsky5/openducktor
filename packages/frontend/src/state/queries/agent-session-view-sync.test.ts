import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  ExternalTaskSyncEvent,
  TaskAgentSessions,
} from "@openducktor/contracts";
import { CancelledError, QueryClient, QueryObserver } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { createAgentSessionsStore } from "../agent-sessions-store";
import { buildAgentSessionLiveCollection } from "../operations/agent-orchestrator/session-read-model/agent-session-live-projection";
import { pruneVanishedWorkflowSessions } from "../operations/agent-orchestrator/session-read-model/agent-session-workflow-records";
import { fromPersistedSessionRecord } from "../operations/agent-orchestrator/support/persistence";
import {
  agentSessionQueryKeys,
  loadAgentSessionListFromQuery,
  updateAgentSessionListQuery,
} from "./agent-sessions";
import {
  createAgentSessionViewSync,
  type AgentSessionViewReadPort,
} from "./agent-session-view-sync";
import { loadExistingTaskIdsFromQuery } from "./tasks";

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

const unusedReadPort: AgentSessionViewReadPort = {
  tasksExistingIds: async () => {
    throw new Error("unexpected task existence read");
  },
  agentSessionsListForTasks: async () => {
    throw new Error("unexpected session batch");
  },
};

const readPort = (overrides: Partial<AgentSessionViewReadPort> = {}): AgentSessionViewReadPort => ({
  ...unusedReadPort,
  ...overrides,
});

describe("AgentSessionViewSync", () => {
  test("a committed session list completes a task-stream refresh without an error", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const older = Promise.withResolvers<TaskAgentSessions[]>();
    const started = Promise.withResolvers<void>();
    const loadSessionBatch = mock(() => {
      started.resolve();
      return older.promise;
    });
    const records = [
      {
        externalSessionId: "native",
        role: "qa" as const,
        runtimeKind: "codex" as const,
        workingDirectory: "/repo",
        startedAt: "2026-10-09T00:00:00.000Z",
        selectedModel: null,
      },
    ];
    const refreshLiveSessions = mock(async () => undefined);
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey,
      queryFn: async () => [],
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: readPort({ agentSessionsListForTasks: loadSessionBatch }),
      removeTaskSessions: () => {},
      refreshLiveSessions,
    });
    try {
      const refreshing = sync.reconcileExternalEvent(event());
      await started.promise;
      updateAgentSessionListQuery(queryClient, "/repo", {
        taskId: "task-1",
        agentSessions: records,
      });
      older.resolve([{ taskId: "task-1", agentSessions: [] }]);
      await refreshing;
      expect(queryClient.getQueryState(queryKey)?.status).toBe("success");
      expect(queryClient.getQueryData<typeof records>(queryKey)).toEqual(records);
      expect(refreshLiveSessions).toHaveBeenCalledTimes(1);
      expect(loadSessionBatch).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });

  test("a stopped snapshot cannot delete sessions after its task existence read finishes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = agentSessionQueryKeys.list("/repo", "unlisted");
    const record = { externalSessionId: "retained" };
    queryClient.setQueryData(key, [record]);
    let finish!: (ids: string[]) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const check = mock(() => {
      started();
      return new Promise<string[]>((resolve) => {
        finish = resolve;
      });
    });
    const port = readPort({ tasksExistingIds: check });
    const removeTaskSessions = mock(() => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: port,
      removeTaskSessions,
      refreshLiveSessions: async () => {},
    });
    try {
      sync.stopPending("snapshot");
      const snapshot = sync.reconcileStreamSnapshot("/repo", []);
      const stopped = snapshot.then(
        () => null,
        (cause: unknown) => cause,
      );
      await ready;
      const checking = loadExistingTaskIdsFromQuery(queryClient, "/repo", ["unlisted"], port).catch(
        (cause: unknown) => cause,
      );
      sync.stopPending("snapshot");
      expect(await stopped).toBeInstanceOf(CancelledError);
      finish([]);
      expect(await checking).toBeInstanceOf(CancelledError);
      expect(queryClient.getQueryData<{ externalSessionId: string }[]>(key)).toEqual([record]);
      expect(removeTaskSessions).not.toHaveBeenCalled();
      expect(check).toHaveBeenCalledTimes(1);
    } finally {
      finish?.([]);
      queryClient.clear();
    }
  });

  test("a replacement snapshot checks task existence again before removing sessions", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = agentSessionQueryKeys.list("/repo", "unlisted");
    queryClient.setQueryData(key, [{ externalSessionId: "retained" }]);
    let finish!: (ids: string[]) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const oldResult = new Promise<string[]>((resolve) => {
      finish = resolve;
    });
    const check = mock(() => {
      if (check.mock.calls.length > 1) return Promise.resolve([]);
      started();
      return oldResult;
    });
    const port = readPort({ tasksExistingIds: check });
    const removeTaskSessions = mock(() => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: port,
      removeTaskSessions,
      refreshLiveSessions: async () => {},
    });
    try {
      sync.stopPending("snapshot");
      const old = sync.reconcileStreamSnapshot("/repo", []).catch((cause: unknown) => cause);
      await ready;
      sync.stopPending("snapshot");
      const current = sync.reconcileStreamSnapshot("/repo", []);
      void current.catch(() => {});
      await waitFor(() => expect(check).toHaveBeenCalledTimes(2), { timeout: 500 });
      await current;
      expect(await old).toBeInstanceOf(CancelledError);
      finish(["unlisted"]);
      await oldResult;
      expect(queryClient.getQueryData(key)).toBeUndefined();
      expect(removeTaskSessions).toHaveBeenCalledTimes(1);
      expect(
        await loadAgentSessionListFromQuery(queryClient, "/repo", "unlisted", {
          forceFresh: true,
          readPort: port,
        }),
      ).toEqual([]);
    } finally {
      finish?.([]);
      queryClient.clear();
    }
  });

  test("a failed task existence read keeps session data and exposes the error", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = agentSessionQueryKeys.list("/repo", "unlisted");
    const record = { externalSessionId: "retained" };
    queryClient.setQueryData(key, [record]);
    const failure = new Error("Task store is unavailable.");
    const removeTaskSessions = mock(() => {});
    const check = mock(async () => {
      throw failure;
    });
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: readPort({ tasksExistingIds: check }),
      removeTaskSessions,
      refreshLiveSessions: async () => {},
    });
    try {
      sync.stopPending("snapshot");
      await expect(sync.reconcileStreamSnapshot("/repo", [])).rejects.toThrow(failure.message);
      expect(queryClient.getQueryData<{ externalSessionId: string }[]>(key)).toEqual([record]);
      expect(removeTaskSessions).not.toHaveBeenCalled();
      expect(check).toHaveBeenCalledTimes(1);
    } finally {
      queryClient.clear();
    }
  });

  for (const expired of [false, true]) {
    test(`a snapshot keeps hidden task history when its query is ${expired ? "expired" : "cached"}`, async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: expired ? 0 : Infinity } },
      });
      const record: AgentSessionRecord = {
        externalSessionId: "closed-task-session",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        role: "build",
        startedAt: "2026-09-03T20:00:00.000Z",
        selectedModel: null,
      };
      const key = agentSessionQueryKeys.list("/repo", "closed");
      const removeTaskSessions = mock(() => {});
      const batch = mock(async (_repo: string, ids: string[]) =>
        ids.map((taskId) => ({ taskId, agentSessions: taskId === "closed" ? [record] : [] })),
      );
      const port = {
        agentSessionsListForTasks: batch,
        tasksExistingIds: mock(async () => ["closed"]),
      };
      const sync = createAgentSessionViewSync({
        queryClient,
        readPort: port,
        removeTaskSessions,
        refreshLiveSessions: async () => {},
      });
      try {
        if (expired) {
          await loadAgentSessionListFromQuery(queryClient, "/repo", "closed", { readPort: port });
          await waitFor(() => expect(queryClient.getQueryState(key)).toBeUndefined(), {
            timeout: 500,
          });
        } else {
          queryClient.setQueryData(key, [record]);
        }
        const readsBeforeSnapshot = batch.mock.calls.length;
        sync.stopPending("snapshot");
        await sync.reconcileStreamSnapshot("/repo", ["visible"]);
        expect(removeTaskSessions).not.toHaveBeenCalledWith("/repo", ["closed"]);
        expect(queryClient.getQueryData<AgentSessionRecord[]>(key)).toEqual(
          expired ? undefined : [record],
        );
        expect(batch).toHaveBeenCalledTimes(readsBeforeSnapshot + 1);
        expect(batch).toHaveBeenCalledWith("/repo", ["visible"]);
        expect(
          await loadAgentSessionListFromQuery(queryClient, "/repo", "closed", {
            forceFresh: true,
            readPort: port,
          }),
        ).toEqual([record]);
        expect(batch).toHaveBeenCalledTimes(readsBeforeSnapshot + 2);
      } finally {
        queryClient.clear();
      }
    });
  }

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
      readPort: readPort({
        agentSessionsListForTasks: async (_repo, ids) =>
          Promise.all(ids.map(async (taskId) => ({ taskId, agentSessions: await loadSessions() }))),
      }),
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
      readPort: readPort({
        agentSessionsListForTasks: async (_repo, ids) =>
          Promise.all(ids.map(async (taskId) => ({ taskId, agentSessions: await loadSessions() }))),
      }),
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
      readPort: readPort({
        agentSessionsListForTasks: async (_repo, ids) =>
          Promise.all(ids.map(async (taskId) => ({ taskId, agentSessions: await loadSessions() }))),
      }),
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
        agentSessionsListForTasks: loadSessionBatch,
      }),
      removeTaskSessions: () => {},
      refreshLiveSessions,
    });

    try {
      sync.stopPending("snapshot");
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
        agentSessionsListForTasks: loadSessionBatch,
        tasksExistingIds: async () => [],
      }),
      removeTaskSessions,
      refreshLiveSessions,
    });

    sync.stopPending("snapshot");
    await sync.reconcileStreamSnapshot("/repo", ["current-task"]);

    expect(queryClient.getQueryData(staleActiveSessionKey)).toBeUndefined();
    expect(queryClient.getQueryData<{ externalSessionId: string }[]>(inactiveSessionKey)).toEqual([
      { externalSessionId: "inactive-session" },
    ]);
    expect(queryClient.getQueryState(inactiveSessionKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData<unknown[]>(currentActiveSessionKey)).toEqual([]);
    expect(removeTaskSessions).toHaveBeenCalledWith("/repo", ["deleted-task"]);
    expect(loadSessionBatch).toHaveBeenCalledWith("/repo", ["current-task"]);
    expect(refreshLiveSessions).toHaveBeenCalledWith("/repo");
  });

  test("repeated snapshots skip deleted tasks while their session queries stay observed", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = agentSessionQueryKeys.list("/repo", "deleted-task");
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: async () => [],
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {});
    const check = mock(async () => []);
    const batch = mock(async () => [{ taskId: "current-task", agentSessions: [] }]);
    const port = readPort({ tasksExistingIds: check, agentSessionsListForTasks: batch });
    const removeTaskSessions = mock((_repoPath: string, _taskIds: string[]) => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: port,
      removeTaskSessions,
      refreshLiveSessions: async () => {},
    });

    try {
      for (let snapshot = 0; snapshot < 2; snapshot++) {
        sync.stopPending("snapshot");
        await sync.reconcileStreamSnapshot("/repo", ["current-task"]);
        expect(queryClient.getQueryData<AgentSessionRecord[]>(key)).toEqual([]);
      }
      expect(check).toHaveBeenCalledTimes(1);
      expect(check).toHaveBeenCalledWith("/repo", ["deleted-task"]);
      expect(
        removeTaskSessions.mock.calls.filter(([, ids]) => ids.includes("deleted-task")),
      ).toHaveLength(1);
      const readsBeforeDeletedLoad = batch.mock.calls.length;
      expect(
        await loadAgentSessionListFromQuery(queryClient, "/repo", "deleted-task", {
          forceFresh: true,
          readPort: port,
        }),
      ).toEqual([]);
      expect(batch).toHaveBeenCalledTimes(readsBeforeDeletedLoad);
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });

  test("a snapshot removes a retained deleted task after its inactive query expires", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const store = createAgentSessionsStore("/repo");
    const record: AgentSessionRecord = {
      externalSessionId: "retained-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      role: "build",
      startedAt: "2026-09-03T20:00:00.000Z",
      selectedModel: null,
    };
    const otherRecord = { ...record, workingDirectory: "/other-repo/worktree" };
    let deleted = false;
    const batch = mock(async (repoPath: string, taskIds: string[]) =>
      taskIds.map((taskId) => {
        if (deleted && repoPath === "/repo" && taskId === "old")
          throw new Error("Task not found: old");
        return {
          taskId,
          agentSessions: taskId === "old" ? [repoPath === "/repo" ? record : otherRecord] : [],
        };
      }),
    );
    const check = mock(async () => []);
    const port = readPort({ agentSessionsListForTasks: batch, tasksExistingIds: check });

    try {
      await loadAgentSessionListFromQuery(queryClient, "/repo", "old", { readPort: port });
      store.replaceSession(fromPersistedSessionRecord({ taskId: "old", record }));
      store.resetWorkspace("/other-repo");
      await loadAgentSessionListFromQuery(queryClient, "/other-repo", "old", { readPort: port });
      store.replaceSession(fromPersistedSessionRecord({ taskId: "old", record: otherRecord }));
      await waitFor(() => {
        expect(
          queryClient.getQueryState(agentSessionQueryKeys.list("/repo", "old")),
        ).toBeUndefined();
      });

      deleted = true;
      store.resetWorkspace("/repo");
      expect(store.listSessionSnapshots()).toHaveLength(1);
      const sync = createAgentSessionViewSync({
        queryClient,
        readPort: port,
        removeTaskSessions: store.removeTaskSessions,
        refreshLiveSessions: async () => {
          store.setSessionCollection((current) =>
            pruneVanishedWorkflowSessions({
              projected: buildAgentSessionLiveCollection({ current, snapshots: [] }),
              records: { loadedTaskIds: new Set(["current"]), records: [] },
            }),
          );
        },
      });
      sync.stopPending("snapshot");
      await sync.reconcileStreamSnapshot("/repo", ["current"]);

      expect(store.listSessionSnapshots()).toHaveLength(0);
      await waitFor(() => {
        expect(
          queryClient.getQueryState(agentSessionQueryKeys.list("/repo", "current")),
        ).toBeUndefined();
      });
      sync.stopPending("snapshot");
      await sync.reconcileStreamSnapshot("/repo", ["current"]);
      expect(check).toHaveBeenCalledTimes(1);
      expect(check).toHaveBeenCalledWith("/repo", ["old"]);
      const readsBeforeDeletedLoad = batch.mock.calls.length;
      expect(
        await loadAgentSessionListFromQuery(queryClient, "/repo", "old", {
          forceFresh: true,
          readPort: port,
        }),
      ).toEqual([]);
      expect(batch).toHaveBeenCalledTimes(readsBeforeDeletedLoad);
      store.resetWorkspace("/other-repo");
      expect(store.listSessionSnapshots()).toHaveLength(1);
      expect(store.listSessionSnapshots()[0]?.workingDirectory).toBe("/other-repo/worktree");
      expect(
        await loadAgentSessionListFromQuery(queryClient, "/other-repo", "old", {
          forceFresh: true,
          readPort: port,
        }),
      ).toEqual([otherRecord]);
    } finally {
      queryClient.clear();
    }
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
      sync.stopPending("snapshot");
      await sync.reconcileStreamSnapshot("/repo", []);

      expect(loadObservedSessions).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryData<typeof freshRecords>(observedKey)).toEqual(freshRecords);
      expect(queryClient.getQueryState(unobservedKey)?.isInvalidated).toBe(true);
    } finally {
      unsubscribe();
    }
  });
});
