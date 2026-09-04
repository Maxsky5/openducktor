import { describe, expect, mock, test } from "bun:test";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { agentSessionQueryKeys } from "./agent-sessions";
import { createAgentSessionViewSync } from "./agent-session-view-sync";

const event = (): ExternalTaskSyncEvent => ({
  kind: "tasks_updated",
  eventId: "event-session-create",
  repoPath: "/repo",
  taskIds: ["task-1"],
  removedTaskIds: [],
  emittedAt: "2026-09-03T20:00:00.000Z",
});

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
    const sync = createAgentSessionViewSync({ queryClient, refreshLiveSessions });

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
    const sync = createAgentSessionViewSync({ queryClient, refreshLiveSessions });

    try {
      await expect(sync.reconcileExternalEvent(event())).rejects.toThrow(
        "session records unavailable",
      );
      expect(refreshLiveSessions).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
