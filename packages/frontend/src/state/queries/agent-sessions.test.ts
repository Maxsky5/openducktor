import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { host } from "../operations/host";
import {
  agentSessionListHydrationQueryOptions,
  agentSessionQueryKeys,
  hydrateAgentSessionListQueries,
  invalidateAgentSessionListQuery,
  loadAgentSessionListsFromQuery,
} from "./agent-sessions";

const sessionFixture: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  startedAt: "2026-03-22T12:00:00.000Z",
  selectedModel: null,
};

describe("agent session query cache helpers", () => {
  test("hydration query keys normalize task ordering, whitespace, duplicates, and empty IDs", () => {
    expect(agentSessionQueryKeys.hydration("/repo", [" task-2 ", "", "task-1", "task-2"])).toEqual([
      "agent-sessions",
      "hydrate-missing-lists",
      "/repo",
      ["task-1", "task-2"],
    ]);
  });

  test("batch hydration makes one normalized host call and seeds canonical per-task caches", async () => {
    const queryClient = new QueryClient();
    const agentSessionsListForTasksMock = mock(async () => [
      { taskId: "task-1", agentSessions: [sessionFixture] },
      { taskId: "task-2", agentSessions: [] },
    ]);
    const originalAgentSessionsListForTasks = host.agentSessionsListForTasks;
    host.agentSessionsListForTasks = agentSessionsListForTasksMock;

    try {
      const result = await queryClient.fetchQuery(
        agentSessionListHydrationQueryOptions(queryClient, "/repo", [
          " task-2 ",
          "task-1",
          "task-2",
        ]),
      );

      expect(result).toBe(true);
      expect(agentSessionsListForTasksMock).toHaveBeenCalledTimes(1);
      expect(agentSessionsListForTasksMock).toHaveBeenCalledWith("/repo", ["task-1", "task-2"]);
      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([sessionFixture]);
      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-2"),
        ),
      ).toEqual([]);
    } finally {
      host.agentSessionsListForTasks = originalAgentSessionsListForTasks;
    }
  });

  test("empty hydration does not call the host", async () => {
    const queryClient = new QueryClient();
    const agentSessionsListForTasksMock = mock(async () => []);
    const originalAgentSessionsListForTasks = host.agentSessionsListForTasks;
    host.agentSessionsListForTasks = agentSessionsListForTasksMock;

    try {
      await hydrateAgentSessionListQueries(queryClient, "/repo", ["", " "]);
      expect(agentSessionsListForTasksMock).not.toHaveBeenCalled();
    } finally {
      host.agentSessionsListForTasks = originalAgentSessionsListForTasks;
    }
  });

  test("batch hydration fails when the host omits a requested task", async () => {
    const queryClient = new QueryClient();
    const originalAgentSessionsListForTasks = host.agentSessionsListForTasks;
    host.agentSessionsListForTasks = async () => [
      { taskId: "task-1", agentSessions: [sessionFixture] },
    ];

    try {
      await expect(
        hydrateAgentSessionListQueries(queryClient, "/repo", ["task-1", "task-2"]),
      ).rejects.toThrow('Batch session response omitted task "task-2".');
      expect(
        queryClient.getQueryData(agentSessionQueryKeys.list("/repo", "task-1")),
      ).toBeUndefined();
      expect(
        queryClient.getQueryData(agentSessionQueryKeys.list("/repo", "task-2")),
      ).toBeUndefined();
    } finally {
      host.agentSessionsListForTasks = originalAgentSessionsListForTasks;
    }
  });

  test("batch hydration does not overwrite a task cache updated while the batch is in flight", async () => {
    const queryClient = new QueryClient();
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const newerSession = { ...sessionFixture, externalSessionId: "external-2" };
    let resolveBatch: (value: { taskId: string; agentSessions: AgentSessionRecord[] }[]) => void =
      () => {
        throw new Error("Batch resolver was not initialized.");
      };
    const originalAgentSessionsListForTasks = host.agentSessionsListForTasks;
    host.agentSessionsListForTasks = () =>
      new Promise((resolve) => {
        resolveBatch = resolve;
      });

    try {
      const hydration = hydrateAgentSessionListQueries(queryClient, "/repo", ["task-1"]);
      queryClient.setQueryData(queryKey, [newerSession]);
      resolveBatch([{ taskId: "task-1", agentSessions: [sessionFixture] }]);
      await hydration;

      expect(queryClient.getQueryData<AgentSessionRecord[]>(queryKey)).toEqual([newerSession]);
    } finally {
      host.agentSessionsListForTasks = originalAgentSessionsListForTasks;
    }
  });

  test("invalidation targets only the canonical per-task cache", async () => {
    const queryClient = new QueryClient();
    const firstListKey = agentSessionQueryKeys.list("/repo", "task-1");
    const secondListKey = agentSessionQueryKeys.list("/repo", "task-2");
    const hydrationKey = agentSessionQueryKeys.hydration("/repo", ["task-1", "task-2"]);
    queryClient.setQueryData(firstListKey, []);
    queryClient.setQueryData(secondListKey, []);
    queryClient.setQueryData(hydrationKey, true);

    await invalidateAgentSessionListQuery(queryClient, "/repo", "task-1");

    expect(queryClient.getQueryState(firstListKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(secondListKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(hydrationKey)?.isInvalidated).toBe(false);
  });

  test("loadAgentSessionListsFromQuery batch-hydrates the per-task session cache", async () => {
    const queryClient = new QueryClient();
    const originalAgentSessionsListForTasks = host.agentSessionsListForTasks;
    const agentSessionsListForTasksMock = mock(async () => [
      { taskId: "task-1", agentSessions: [sessionFixture] },
      { taskId: "task-2", agentSessions: [] },
    ]);
    host.agentSessionsListForTasks = agentSessionsListForTasksMock;

    try {
      const sessionsByTaskId = await loadAgentSessionListsFromQuery(queryClient, "/repo", [
        "task-1",
        "task-2",
      ]);

      expect(sessionsByTaskId).toEqual({
        "task-1": [sessionFixture],
        "task-2": [],
      });
      expect(agentSessionsListForTasksMock).toHaveBeenCalledTimes(1);
      expect(agentSessionsListForTasksMock).toHaveBeenCalledWith("/repo", ["task-1", "task-2"]);
      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([sessionFixture]);
      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-2"),
        ),
      ).toEqual([]);
    } finally {
      host.agentSessionsListForTasks = originalAgentSessionsListForTasks;
    }
  });

  test("loadAgentSessionListsFromQuery batch-hydrates only missing per-task caches", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [sessionFixture]);
    const originalAgentSessionsListForTasks = host.agentSessionsListForTasks;
    const agentSessionsListForTasksMock = mock(async () => [
      { taskId: "task-2", agentSessions: [] },
    ]);
    host.agentSessionsListForTasks = agentSessionsListForTasksMock;

    try {
      const sessionsByTaskId = await loadAgentSessionListsFromQuery(queryClient, "/repo", [
        "task-1",
        "task-2",
      ]);

      expect(sessionsByTaskId).toEqual({
        "task-1": [sessionFixture],
        "task-2": [],
      });
      expect(agentSessionsListForTasksMock).toHaveBeenCalledWith("/repo", ["task-2"]);
    } finally {
      host.agentSessionsListForTasks = originalAgentSessionsListForTasks;
    }
  });

  test("loadAgentSessionListsFromQuery reuses hydrated per-task cache entries", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [sessionFixture]);

    const originalAgentSessionsListForTasks = host.agentSessionsListForTasks;
    host.agentSessionsListForTasks = async () => {
      throw new Error("The cached per-task session list should be authoritative.");
    };

    try {
      const sessionsByTaskId = await loadAgentSessionListsFromQuery(queryClient, "/repo", [
        "task-1",
      ]);

      expect(sessionsByTaskId).toEqual({
        "task-1": [sessionFixture],
      });
    } finally {
      host.agentSessionsListForTasks = originalAgentSessionsListForTasks;
    }
  });
});
