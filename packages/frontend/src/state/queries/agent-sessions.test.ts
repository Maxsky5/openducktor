import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  type AgentSessionReadPort,
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

const createReadPort = (
  agentSessionsListForTasks: AgentSessionReadPort["agentSessionsListForTasks"],
): AgentSessionReadPort => ({
  agentSessionsList: async () => {
    throw new Error("The per-task read was not expected.");
  },
  agentSessionsListForTasks,
});

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
    const result = await queryClient.fetchQuery(
      agentSessionListHydrationQueryOptions(
        queryClient,
        "/repo",
        [" task-2 ", "task-1", "task-2"],
        createReadPort(agentSessionsListForTasksMock),
      ),
    );

    expect(result).toBe(true);
    expect(agentSessionsListForTasksMock).toHaveBeenCalledTimes(1);
    expect(agentSessionsListForTasksMock).toHaveBeenCalledWith("/repo", ["task-1", "task-2"]);
    expect(
      queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "task-1")),
    ).toEqual([sessionFixture]);
    expect(
      queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "task-2")),
    ).toEqual([]);
  });

  test("empty hydration does not call the host", async () => {
    const queryClient = new QueryClient();
    const agentSessionsListForTasksMock = mock(async () => []);
    await hydrateAgentSessionListQueries(
      queryClient,
      "/repo",
      ["", " "],
      createReadPort(agentSessionsListForTasksMock),
    );
    expect(agentSessionsListForTasksMock).not.toHaveBeenCalled();
  });

  test("batch hydration fails when the host omits a requested task", async () => {
    const queryClient = new QueryClient();
    const readPort = createReadPort(async () => [
      { taskId: "task-1", agentSessions: [sessionFixture] },
    ]);

    await expect(
      hydrateAgentSessionListQueries(queryClient, "/repo", ["task-1", "task-2"], readPort),
    ).rejects.toThrow('Batch session response omitted task "task-2".');
    expect(queryClient.getQueryData(agentSessionQueryKeys.list("/repo", "task-1"))).toBeUndefined();
    expect(queryClient.getQueryData(agentSessionQueryKeys.list("/repo", "task-2"))).toBeUndefined();
  });

  test("batch hydration does not overwrite a task cache updated while the batch is in flight", async () => {
    const queryClient = new QueryClient();
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const newerSession = { ...sessionFixture, externalSessionId: "external-2" };
    let resolveBatch: (value: { taskId: string; agentSessions: AgentSessionRecord[] }[]) => void =
      () => {
        throw new Error("Batch resolver was not initialized.");
      };
    const readPort = createReadPort(
      () =>
        new Promise((resolve) => {
          resolveBatch = resolve;
        }),
    );

    const hydration = hydrateAgentSessionListQueries(queryClient, "/repo", ["task-1"], readPort);
    queryClient.setQueryData(queryKey, [newerSession]);
    resolveBatch([{ taskId: "task-1", agentSessions: [sessionFixture] }]);
    await hydration;

    expect(queryClient.getQueryData<AgentSessionRecord[]>(queryKey)).toEqual([newerSession]);
  });

  test("batch hydration does not overwrite an invalidation repeated while already invalidated", async () => {
    const queryClient = new QueryClient();
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    let resolveBatch: (value: { taskId: string; agentSessions: AgentSessionRecord[] }[]) => void =
      () => {
        throw new Error("Batch resolver was not initialized.");
      };
    const agentSessionsListForTasksMock = mock(
      () =>
        new Promise<{ taskId: string; agentSessions: AgentSessionRecord[] }[]>((resolve) => {
          resolveBatch = resolve;
        }),
    );
    queryClient.setQueryData(queryKey, [sessionFixture]);
    await invalidateAgentSessionListQuery(queryClient, "/repo", "task-1");

    const hydration = queryClient
      .fetchQuery(
        agentSessionListHydrationQueryOptions(
          queryClient,
          "/repo",
          ["task-1"],
          createReadPort(agentSessionsListForTasksMock),
        ),
      )
      .catch(() => undefined);
    await Promise.resolve();
    expect(agentSessionsListForTasksMock).toHaveBeenCalledTimes(1);

    await invalidateAgentSessionListQuery(queryClient, "/repo", "task-1");
    resolveBatch([
      {
        taskId: "task-1",
        agentSessions: [{ ...sessionFixture, externalSessionId: "stale-session" }],
      },
    ]);
    await hydration;

    expect(queryClient.getQueryData<AgentSessionRecord[]>(queryKey)).toEqual([sessionFixture]);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
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
    const agentSessionsListForTasksMock = mock(async () => [
      { taskId: "task-1", agentSessions: [sessionFixture] },
      { taskId: "task-2", agentSessions: [] },
    ]);
    const sessionsByTaskId = await loadAgentSessionListsFromQuery(
      queryClient,
      "/repo",
      ["task-1", "task-2"],
      { readPort: createReadPort(agentSessionsListForTasksMock) },
    );

    expect(sessionsByTaskId).toEqual({
      "task-1": [sessionFixture],
      "task-2": [],
    });
    expect(agentSessionsListForTasksMock).toHaveBeenCalledTimes(1);
    expect(agentSessionsListForTasksMock).toHaveBeenCalledWith("/repo", ["task-1", "task-2"]);
    expect(
      queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "task-1")),
    ).toEqual([sessionFixture]);
    expect(
      queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "task-2")),
    ).toEqual([]);
  });

  test("loadAgentSessionListsFromQuery batch-hydrates only missing per-task caches", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [sessionFixture]);
    const agentSessionsListForTasksMock = mock(async () => [
      { taskId: "task-2", agentSessions: [] },
    ]);
    const sessionsByTaskId = await loadAgentSessionListsFromQuery(
      queryClient,
      "/repo",
      ["task-1", "task-2"],
      { readPort: createReadPort(agentSessionsListForTasksMock) },
    );

    expect(sessionsByTaskId).toEqual({
      "task-1": [sessionFixture],
      "task-2": [],
    });
    expect(agentSessionsListForTasksMock).toHaveBeenCalledWith("/repo", ["task-2"]);
  });

  test("loadAgentSessionListsFromQuery reuses hydrated per-task cache entries", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [sessionFixture]);

    const readPort = createReadPort(async () => {
      throw new Error("The cached per-task session list should be authoritative.");
    });

    const sessionsByTaskId = await loadAgentSessionListsFromQuery(
      queryClient,
      "/repo",
      ["task-1"],
      { readPort },
    );

    expect(sessionsByTaskId).toEqual({
      "task-1": [sessionFixture],
    });
  });

  test("loadAgentSessionListsFromQuery refreshes invalidated per-task cache entries", async () => {
    const queryClient = new QueryClient();
    const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
    const refreshedSession = { ...sessionFixture, externalSessionId: "external-2" };
    const agentSessionsListForTasksMock = mock(async () => [
      { taskId: "task-1", agentSessions: [refreshedSession] },
    ]);
    queryClient.setQueryData(queryKey, [sessionFixture]);
    await invalidateAgentSessionListQuery(queryClient, "/repo", "task-1");

    const sessionsByTaskId = await loadAgentSessionListsFromQuery(
      queryClient,
      "/repo",
      ["task-1"],
      { readPort: createReadPort(agentSessionsListForTasksMock) },
    );

    expect(agentSessionsListForTasksMock).toHaveBeenCalledTimes(1);
    expect(sessionsByTaskId).toEqual({ "task-1": [refreshedSession] });
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });
});
