import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { agentSessionQueryKeys, upsertAgentSessionRecordInQuery } from "./agent-sessions";

const sessionFixture: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  scenario: "build_implementation_start",
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
});
