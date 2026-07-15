import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { taskQueryKeys } from "@/state/queries/tasks";
import { createSessionCacheEffects } from "./session-cache-effects";

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
  test("persists and authoritatively refetches the canonical task query", async () => {
    const queryClient = createQueryClient();
    let persistedSessions: AgentSessionRecord[] = [];
    const upsert = mock(async (_repoPath: string, _taskId: string, record: AgentSessionRecord) => {
      persistedSessions = [record];
    });
    const list = mock(async () => persistedSessions);
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), []);
    const effects = createSessionCacheEffects({
      workspaceRepoPath: "/repo",
      queryClient,
      hostPort: {
        agentSessionDelete: async () => undefined,
        agentSessionsList: list,
        agentSessionUpsert: upsert,
      },
    });

    await effects.persistSessionRecord("task-1", sessionRecord);

    expect(upsert).toHaveBeenCalledWith("/repo", "task-1", sessionRecord);
    expect(list).toHaveBeenCalledWith("/repo", "task-1");
    expect(
      queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "task-1")),
    ).toEqual([sessionRecord]);
    expect(
      queryClient.getQueryState(agentSessionQueryKeys.list("/repo", "task-1"))?.isInvalidated,
    ).toBe(false);
  });

  test("fails instead of silently dropping a session record without an active workspace", async () => {
    const queryClient = createQueryClient();
    const upsert = mock(async () => undefined);
    const effects = createSessionCacheEffects({
      workspaceRepoPath: null,
      queryClient,
      hostPort: {
        agentSessionDelete: async () => undefined,
        agentSessionsList: async () => [],
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
        agentSessionsList: async () => [],
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

  test("deletes through the injected host port and removes only the matching cache record", async () => {
    const queryClient = createQueryClient();
    const deleteSession = mock(async () => undefined);
    const otherSession = { ...sessionRecord, externalSessionId: "session-2" };
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [
      sessionRecord,
      otherSession,
    ]);
    const effects = createSessionCacheEffects({
      workspaceRepoPath: "/repo",
      queryClient,
      hostPort: {
        agentSessionDelete: deleteSession,
        agentSessionsList: async () => [otherSession],
        agentSessionUpsert: async () => undefined,
      },
    });

    await effects.deleteSessionRecord("task-1", sessionRecord);

    expect(deleteSession).toHaveBeenCalledWith("/repo", "task-1", sessionRecord);
    expect(
      queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "task-1")),
    ).toEqual([otherSession]);
  });
});
