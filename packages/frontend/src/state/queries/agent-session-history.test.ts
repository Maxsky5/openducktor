import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionHistoryMessage, AgentSessionRef } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { agentSessionHistoryQueryKeys, sessionHistoryQueryOptions } from "./agent-session-history";

const sessionRefFixture: AgentSessionRef = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};

const historyMessageFixture: AgentSessionHistoryMessage = {
  messageId: "message-1",
  role: "user",
  timestamp: "2026-02-22T12:00:00.000Z",
  text: "Continue the implementation",
  displayParts: [],
  state: "read",
  parts: [],
};

describe("agent session history queries", () => {
  test("keys session history by the concrete runtime session identity", () => {
    expect(agentSessionHistoryQueryKeys.history(sessionRefFixture)).toEqual([
      "agent-session-history",
      "/repo",
      "opencode",
      "/repo/worktree",
      "session-1",
    ]);
  });

  test("loads history only for a concrete session ref", async () => {
    const queryClient = new QueryClient();
    const readSessionHistory = mock(async () => [historyMessageFixture]);

    const history = await queryClient.fetchQuery(
      sessionHistoryQueryOptions(sessionRefFixture, readSessionHistory),
    );

    expect(history).toEqual([historyMessageFixture]);
    expect(readSessionHistory).toHaveBeenCalledWith(sessionRefFixture);
  });
});
