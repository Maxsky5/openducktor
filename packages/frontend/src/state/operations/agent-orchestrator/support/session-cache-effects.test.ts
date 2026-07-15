import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { taskQueryKeys } from "@/state/queries/tasks";
import {
  createSessionCacheEffects,
  sessionCacheRefreshFailureDescription,
} from "./session-cache-effects";

const sessionRecord: AgentSessionRecord = {
  runtimeKind: "opencode",
  externalSessionId: "session-1",
  role: "build",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/repo/worktree",
  selectedModel: null,
};

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

describe("createSessionCacheEffects", () => {
  test("formats the default cache refresh report with repository, task, and error", () => {
    expect(
      sessionCacheRefreshFailureDescription({
        repoPath: "/repo",
        taskId: "task-1",
        error: new Error("refresh failed"),
      }),
    ).toBe("/repo · task-1: refresh failed");
  });

  test("persists and authoritatively refetches the canonical task query", async () => {
    const queryClient = createQueryClient();
    let persistedSessions: AgentSessionRecord[] = [];
    const upsert = mock(async (_repoPath: string, _taskId: string, record: AgentSessionRecord) => {
      persistedSessions = [record];
    });
    const list = mock(async () => persistedSessions);
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    await queryClient.fetchQuery({ queryKey, queryFn: list });
    const effects = createSessionCacheEffects({
      workspaceRepoPath: "/repo",
      queryClient,
      hostPort: {
        agentSessionDelete: async () => undefined,
        agentSessionUpsert: upsert,
      },
    });

    await effects.persistSessionRecord("task-1", sessionRecord);

    expect(upsert).toHaveBeenCalledWith("/repo", "task-1", sessionRecord);
    expect(list).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData<AgentSessionRecord[]>(queryKey)).toEqual([sessionRecord]);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });

  test("keeps a successful durable write successful when the query refresh fails", async () => {
    const queryClient = createQueryClient();
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    let failRefresh = false;
    await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => {
        if (failRefresh) {
          throw new Error("Session cache refresh failed.");
        }
        return [];
      },
    });
    const upsert = mock(async () => undefined);
    const reportCacheRefreshFailure = mock(() => undefined);
    const effects = createSessionCacheEffects({
      workspaceRepoPath: "/repo",
      queryClient,
      hostPort: { agentSessionDelete: async () => undefined, agentSessionUpsert: upsert },
      reportCacheRefreshFailure,
    });
    failRefresh = true;

    await expect(effects.persistSessionRecord("task-1", sessionRecord)).resolves.toBeUndefined();

    expect(upsert).toHaveBeenCalledWith("/repo", "task-1", sessionRecord);
    expect(queryClient.getQueryState(queryKey)?.status).toBe("error");
    expect(queryClient.getQueryState(queryKey)?.error).toEqual(
      new Error("Session cache refresh failed."),
    );
    expect(reportCacheRefreshFailure).toHaveBeenCalledWith({
      repoPath: "/repo",
      taskId: "task-1",
      error: new Error("Session cache refresh failed."),
    });
  });

  test("propagates persistence failures without reporting a cache refresh failure", async () => {
    const queryClient = createQueryClient();
    const persistenceError = new Error("Session persistence failed.");
    const reportCacheRefreshFailure = mock(() => undefined);
    const effects = createSessionCacheEffects({
      workspaceRepoPath: "/repo",
      queryClient,
      hostPort: {
        agentSessionDelete: async () => undefined,
        agentSessionUpsert: async () => {
          throw persistenceError;
        },
      },
      reportCacheRefreshFailure,
    });

    await expect(effects.persistSessionRecord("task-1", sessionRecord)).rejects.toBe(
      persistenceError,
    );
    expect(reportCacheRefreshFailure).not.toHaveBeenCalled();
  });

  test("fails instead of silently dropping a session record without an active workspace", async () => {
    const queryClient = createQueryClient();
    const upsert = mock(async () => undefined);
    const effects = createSessionCacheEffects({
      workspaceRepoPath: null,
      queryClient,
      hostPort: {
        agentSessionDelete: async () => undefined,
        agentSessionUpsert: upsert,
      },
    });

    await expect(effects.persistSessionRecord("task-1", sessionRecord)).rejects.toThrow(
      "Active workspace repo path is unavailable.",
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "task-1")),
    ).toBeUndefined();
  });

  test("invalidates stop-related queries on the injected query client", async () => {
    const queryClient = createQueryClient();
    const invalidatedKeys: unknown[] = [];
    const originalInvalidateQueries = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = (async (filters = {}) => {
      invalidatedKeys.push(filters.queryKey);
      return originalInvalidateQueries({ ...filters, refetchType: "none" });
    }) as QueryClient["invalidateQueries"];
    const effects = createSessionCacheEffects({
      workspaceRepoPath: "/repo",
      queryClient,
      hostPort: {
        agentSessionDelete: async () => undefined,
        agentSessionUpsert: async () => undefined,
      },
    });

    await effects.invalidateSessionStopQueries({
      repoPath: "/repo",
      taskId: "task-1",
    });

    expect(invalidatedKeys).toContainEqual(taskQueryKeys.repoDataPrefix("/repo"));
    expect(invalidatedKeys).toContainEqual(agentSessionQueryKeys.list("/repo", "task-1"));
  });

  test("deletes through the injected host port and authoritatively refetches the task query", async () => {
    const queryClient = createQueryClient();
    const otherSession = { ...sessionRecord, externalSessionId: "session-2" };
    let persistedSessions = [sessionRecord, otherSession];
    const list = mock(async () => persistedSessions);
    const deleteSession = mock(async () => {
      persistedSessions = [otherSession];
    });
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    await queryClient.fetchQuery({ queryKey, queryFn: list });
    const effects = createSessionCacheEffects({
      workspaceRepoPath: "/repo",
      queryClient,
      hostPort: {
        agentSessionDelete: deleteSession,
        agentSessionUpsert: async () => undefined,
      },
    });

    await effects.deleteSessionRecord("task-1", sessionRecord);

    expect(deleteSession).toHaveBeenCalledWith("/repo", "task-1", sessionRecord);
    expect(list).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData<AgentSessionRecord[]>(queryKey)).toEqual([otherSession]);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });
});
