import { describe, expect, mock, test } from "bun:test";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { agentSessionQueryKeys, type AgentSessionReadPort } from "./agent-sessions";
import { createAgentSessionViewSync } from "./agent-session-view-sync";
import { taskQueryKeys } from "./tasks";

const event = (): ExternalTaskSyncEvent => ({
  kind: "tasks_updated",
  eventId: "event-session-create",
  repoPath: "/repo",
  taskIds: ["task-1"],
  removedTaskIds: [],
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

describe("AgentSessionViewSync", () => {
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
      readPort: unusedReadPort,
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
      readPort: unusedReadPort,
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

  test("removes session state and the cached list for a deleted task", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const loadSessions = mock(async () => []);
    const removeTaskSessions = mock((_taskIds: string[]) => {});
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
      readPort: unusedReadPort,
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
        emittedAt: "2026-09-03T20:00:00.000Z",
      });

      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
      expect(removeTaskSessions).toHaveBeenCalledWith(["task-1"]);
      expect(refreshLiveSessions).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  test("reloads task session records and live sessions for a stream snapshot", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const taskQueryKey = taskQueryKeys.repoData("/repo", 7);
    const sessionQueryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const loadSessions = mock(async () => []);
    const loadSessionBatch = mock(async () => [{ taskId: "task-1", agentSessions: [] }]);
    const refreshLiveSessions = mock(async () => undefined);
    const unsubscribeTasks = new QueryObserver(queryClient, {
      queryKey: taskQueryKey,
      queryFn: async () => ({ tasks: [{ id: "task-1" }] }),
      initialData: { tasks: [{ id: "task-1" }] },
      staleTime: Infinity,
    }).subscribe(() => {});
    const unsubscribeSessions = new QueryObserver(queryClient, {
      queryKey: sessionQueryKey,
      queryFn: loadSessions,
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {});
    const sync = createAgentSessionViewSync({
      queryClient,
      readPort: {
        agentSessionsList: loadSessions,
        agentSessionsListForTasks: loadSessionBatch,
      },
      removeTaskSessions: () => {},
      refreshLiveSessions,
    });

    try {
      await sync.reconcileStreamSnapshot("/repo");

      expect(loadSessionBatch).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(refreshLiveSessions).toHaveBeenCalledWith("/repo");
    } finally {
      unsubscribeSessions();
      unsubscribeTasks();
    }
  });
});
