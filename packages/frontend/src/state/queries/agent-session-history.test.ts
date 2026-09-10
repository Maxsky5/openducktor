import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionHistoryMessage, LoadAgentSessionHistoryInput } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { agentSessionHistoryQueryKeys, sessionHistoryQueryOptions } from "./agent-session-history";

const sessionRefFixture: LoadAgentSessionHistoryInput = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
  runtimePolicy: { kind: "opencode" },
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
  test("deduplicates equal reads while separating result-shaping inputs", async () => {
    const client = new QueryClient();
    const result = Promise.withResolvers<AgentSessionHistoryMessage[]>();
    const reader = mock(() => result.promise);
    const inputs: LoadAgentSessionHistoryInput[] = [
      sessionRefFixture,
      { ...sessionRefFixture, limit: 5 },
      { ...sessionRefFixture, systemPrompt: "Read only" },
      { ...sessionRefFixture, sessionScope: { kind: "repository" } },
    ];
    const reads = inputs.flatMap((input) => [
      client.fetchQuery(sessionHistoryQueryOptions(input, reader)),
      client.fetchQuery(sessionHistoryQueryOptions({ ...input }, reader)),
    ]);
    expect(reader).toHaveBeenCalledTimes(inputs.length);
    result.resolve([historyMessageFixture]);
    await Promise.all(reads);
  });
  test("keys session history by the concrete runtime session identity", () => {
    expect(agentSessionHistoryQueryKeys.history(sessionRefFixture)).toEqual([
      "agent-session-history",
      "/repo",
      "opencode",
      "/repo/worktree",
      "session-1",
      {
        runtimePolicy: { kind: "opencode" },
        sessionScope: undefined,
        limit: undefined,
        systemPromptContext: undefined,
        systemPrompt: undefined,
        model: undefined,
      },
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
