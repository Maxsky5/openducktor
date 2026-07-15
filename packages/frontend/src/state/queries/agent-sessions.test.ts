import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { host } from "../operations/host";
import {
  agentSessionListsQueryOptions,
  agentSessionQueryKeys,
  invalidateAgentSessionListQuery,
  loadAgentSessionListsFromQuery,
  removeAgentSessionRecordFromQuery,
  upsertAgentSessionRecordInQuery,
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
  const selectedModelFixture: NonNullable<AgentSessionRecord["selectedModel"]> = {
    runtimeKind: "opencode",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    variant: "latest",
    profileId: "work",
  };

  test("batch query keys normalize task ordering, whitespace, duplicates, and empty IDs", () => {
    expect(
      agentSessionQueryKeys.listForTasks("/repo", [" task-2 ", "", "task-1", "task-2"]),
    ).toEqual(["agent-sessions", "list-for-tasks", "/repo", ["task-1", "task-2"]]);
  });

  test("agentSessionListsQueryOptions makes one normalized host call and defaults missing tasks", async () => {
    const queryClient = new QueryClient();
    const agentSessionsListForTasksMock = mock(async () => [
      { taskId: "task-1", agentSessions: [sessionFixture] },
    ]);
    const originalAgentSessionsListForTasks = host.agentSessionsListForTasks;
    host.agentSessionsListForTasks = agentSessionsListForTasksMock;

    try {
      const result = await queryClient.fetchQuery(
        agentSessionListsQueryOptions("/repo", [" task-2 ", "task-1", "task-2"]),
      );

      expect(result).toEqual({
        "task-1": [sessionFixture],
        "task-2": [],
      });
      expect(agentSessionsListForTasksMock).toHaveBeenCalledTimes(1);
      expect(agentSessionsListForTasksMock).toHaveBeenCalledWith("/repo", ["task-1", "task-2"]);
    } finally {
      host.agentSessionsListForTasks = originalAgentSessionsListForTasks;
    }
  });

  test("upsertAgentSessionRecordInQuery inserts a missing session record", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), []);

    upsertAgentSessionRecordInQuery(queryClient, "/repo", "task-1", sessionFixture);

    const sessions = queryClient.getQueryData<AgentSessionRecord[]>(
      agentSessionQueryKeys.list("/repo", "task-1"),
    );

    expect(sessions).toEqual([sessionFixture]);
  });

  test("upsertAgentSessionRecordInQuery replaces an existing session record with the same identity", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [sessionFixture]);

    const updatedSession: AgentSessionRecord = {
      ...sessionFixture,
      startedAt: "2026-03-22T12:30:00.000Z",
    };

    upsertAgentSessionRecordInQuery(queryClient, "/repo", "task-1", updatedSession);

    const sessions = queryClient.getQueryData<AgentSessionRecord[]>(
      agentSessionQueryKeys.list("/repo", "task-1"),
    );

    expect(sessions).toEqual([updatedSession]);
  });

  test("upsertAgentSessionRecordInQuery keeps equivalent session records stable", () => {
    const queryClient = new QueryClient();
    const sessionWithModel: AgentSessionRecord = {
      ...sessionFixture,
      selectedModel: selectedModelFixture,
    };
    const cachedSessions = [sessionWithModel];
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), cachedSessions);

    upsertAgentSessionRecordInQuery(queryClient, "/repo", "task-1", {
      ...sessionWithModel,
      selectedModel: {
        ...selectedModelFixture,
      },
    });

    const sessions = queryClient.getQueryData<AgentSessionRecord[]>(
      agentSessionQueryKeys.list("/repo", "task-1"),
    );

    expect(sessions).toBe(cachedSessions);
    expect(sessions?.[0]).toBe(sessionWithModel);
  });

  test("upsertAgentSessionRecordInQuery replaces records when selected model changes", () => {
    const queryClient = new QueryClient();
    const originalSession: AgentSessionRecord = {
      ...sessionFixture,
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
      },
    };
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [originalSession]);

    const updatedSession: AgentSessionRecord = {
      ...originalSession,
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-opus",
      },
    };
    upsertAgentSessionRecordInQuery(queryClient, "/repo", "task-1", updatedSession);

    const sessions = queryClient.getQueryData<AgentSessionRecord[]>(
      agentSessionQueryKeys.list("/repo", "task-1"),
    );

    expect(sessions).toEqual([updatedSession]);
  });

  test("upsertAgentSessionRecordInQuery keeps records distinct when only external id matches", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [sessionFixture]);

    const otherRuntimeSession: AgentSessionRecord = {
      ...sessionFixture,
      runtimeKind: "codex",
      workingDirectory: "/tmp/repo/codex-worktree",
    };

    upsertAgentSessionRecordInQuery(queryClient, "/repo", "task-1", otherRuntimeSession);

    const sessions = queryClient.getQueryData<AgentSessionRecord[]>(
      agentSessionQueryKeys.list("/repo", "task-1"),
    );

    expect(sessions).toEqual([sessionFixture, otherRuntimeSession]);
  });

  test("upsertAgentSessionRecordInQuery updates repository batch caches containing the task", () => {
    const queryClient = new QueryClient();
    const batchKey = agentSessionQueryKeys.listForTasks("/repo", ["task-1", "task-2"]);
    queryClient.setQueryData(batchKey, { "task-1": [], "task-2": [] });
    queryClient.setQueryData(agentSessionQueryKeys.listForTasks("/other", ["task-1"]), {
      "task-1": [],
    });

    upsertAgentSessionRecordInQuery(queryClient, "/repo", "task-1", sessionFixture);

    expect(queryClient.getQueryData<Record<string, AgentSessionRecord[]>>(batchKey)).toEqual({
      "task-1": [sessionFixture],
      "task-2": [],
    });
    expect(
      queryClient.getQueryData<Record<string, AgentSessionRecord[]>>(
        agentSessionQueryKeys.listForTasks("/other", ["task-1"]),
      ),
    ).toEqual({ "task-1": [] });
  });

  test("removeAgentSessionRecordFromQuery updates repository batch caches containing the task", () => {
    const queryClient = new QueryClient();
    const batchKey = agentSessionQueryKeys.listForTasks("/repo", ["task-1", "task-2"]);
    const otherBatchKey = agentSessionQueryKeys.listForTasks("/other", ["task-1"]);
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [sessionFixture]);
    queryClient.setQueryData(batchKey, { "task-1": [sessionFixture], "task-2": [] });
    queryClient.setQueryData(otherBatchKey, { "task-1": [sessionFixture] });

    removeAgentSessionRecordFromQuery(queryClient, "/repo", "task-1", sessionFixture);

    expect(
      queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "task-1")),
    ).toEqual([]);
    expect(queryClient.getQueryData<Record<string, AgentSessionRecord[]>>(batchKey)).toEqual({
      "task-1": [],
      "task-2": [],
    });
    expect(queryClient.getQueryData<Record<string, AgentSessionRecord[]>>(otherBatchKey)).toEqual({
      "task-1": [sessionFixture],
    });
  });

  test("invalidateAgentSessionListQuery invalidates per-task and repository batch caches", async () => {
    const queryClient = new QueryClient();
    const listKey = agentSessionQueryKeys.list("/repo", "task-1");
    const batchKey = agentSessionQueryKeys.listForTasks("/repo", ["task-1", "task-2"]);
    const otherBatchKey = agentSessionQueryKeys.listForTasks("/other", ["task-1"]);
    queryClient.setQueryData(listKey, []);
    queryClient.setQueryData(batchKey, { "task-1": [], "task-2": [] });
    queryClient.setQueryData(otherBatchKey, { "task-1": [] });

    await invalidateAgentSessionListQuery(queryClient, "/repo", "task-1");

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(batchKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherBatchKey)?.isInvalidated).toBe(false);
  });

  test("loadAgentSessionListsFromQuery reads the per-task session cache", async () => {
    const queryClient = new QueryClient();
    const originalAgentSessionsList = host.agentSessionsList;
    const hostCalls: string[] = [];
    host.agentSessionsList = async (_repoPath, taskId) => {
      hostCalls.push(taskId);
      return taskId === "task-2" ? [] : [sessionFixture];
    };

    try {
      const sessionsByTaskId = await loadAgentSessionListsFromQuery(queryClient, "/repo", [
        "task-1",
        "task-2",
      ]);

      expect(sessionsByTaskId).toEqual({
        "task-1": [sessionFixture],
        "task-2": [],
      });
      expect(hostCalls).toEqual(["task-1", "task-2"]);
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
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("loadAgentSessionListsFromQuery uses the same list cache updated by session upserts", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), []);
    upsertAgentSessionRecordInQuery(queryClient, "/repo", "task-1", sessionFixture);

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
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
      host.agentSessionsList = originalAgentSessionsList;
    }
  });
});
