import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { host } from "../operations/host";
import {
  agentSessionQueryKeys,
  loadAgentSessionListsFromQuery,
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
  test("upsertAgentSessionRecordInQuery inserts a missing session record", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), []);

    upsertAgentSessionRecordInQuery(queryClient, "/repo", "task-1", sessionFixture);

    const sessions = queryClient.getQueryData<AgentSessionRecord[]>(
      agentSessionQueryKeys.list("/repo", "task-1"),
    );

    expect(sessions).toEqual([sessionFixture]);
  });

  test("upsertAgentSessionRecordInQuery replaces an existing session record with the same id", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [sessionFixture]);

    const updatedSession: AgentSessionRecord = {
      ...sessionFixture,
      workingDirectory: "/tmp/repo/updated-worktree",
    };

    upsertAgentSessionRecordInQuery(queryClient, "/repo", "task-1", updatedSession);

    const sessions = queryClient.getQueryData<AgentSessionRecord[]>(
      agentSessionQueryKeys.list("/repo", "task-1"),
    );

    expect(sessions).toEqual([updatedSession]);
  });

  test("loadAgentSessionListsFromQuery seeds per-task session caches from the bulk read", async () => {
    const queryClient = new QueryClient();
    const originalAgentSessionsListBulk = host.agentSessionsListBulk;
    host.agentSessionsListBulk = async () => ({
      "task-1": [sessionFixture],
      "task-2": [],
    });

    try {
      const sessionsByTaskId = await loadAgentSessionListsFromQuery(queryClient, "/repo", [
        "task-1",
        "task-2",
      ]);

      expect(sessionsByTaskId).toEqual({
        "task-1": [sessionFixture],
        "task-2": [],
      });
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
      host.agentSessionsListBulk = originalAgentSessionsListBulk;
    }
  });
});
