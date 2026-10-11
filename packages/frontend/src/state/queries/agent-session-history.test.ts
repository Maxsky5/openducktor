import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionHistoryMessage, LoadAgentSessionHistoryInput } from "@openducktor/core";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { createLiveSnapshotEnvelope } from "@/test-utils/agent-session-live-fixture";
import { sessionHistoryCoverage } from "./agent-session-history-coverage";
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
  const snapshot: AgentSessionLiveSnapshot = {
    ref: sessionRefFixture,
    activity: "idle",
    title: "Chat",
    startedAt: "2026-02-22T12:00:00.000Z",
    pendingApprovals: [],
    pendingQuestions: [],
    contextUsage: null,
  };

  test("reuses covered history on reopen and reads again after activity, a gap, or loss of coverage", async () => {
    const client = new QueryClient();
    const observation = sessionHistoryCoverage(client).observe("/repo");
    observation.accept(createLiveSnapshotEnvelope({ sessions: [snapshot] }));
    const reader = mock(async () => [{ ...historyMessageFixture }]);
    const options = sessionHistoryQueryOptions(sessionRefFixture, reader, client);
    const reopen = async () => {
      const observer = new QueryObserver(client, options);
      const stop = observer.subscribe(() => {});
      try {
        return await client.fetchQuery(options);
      } finally {
        stop();
      }
    };
    try {
      await reopen();
      await reopen();
      expect(reader).toHaveBeenCalledTimes(1);
      observation.accept({
        type: "session_upsert",
        session: { ...snapshot, title: "Renamed chat" },
      });
      await reopen();
      expect(reader).toHaveBeenCalledTimes(1);
      observation.accept({
        type: "session_upsert",
        session: { ...snapshot, ref: { ...snapshot.ref, externalSessionId: "other" } },
      });
      await reopen();
      expect(reader).toHaveBeenCalledTimes(1);
      observation.accept({ type: "session_upsert", session: { ...snapshot, activity: "running" } });
      await reopen();
      expect(reader).toHaveBeenCalledTimes(2);
      observation.accept(
        createLiveSnapshotEnvelope({
          sessions: [snapshot],
          isConnectionSnapshot: true,
          historyReplayGap: true,
        }),
      );
      await reopen();
      expect(reader).toHaveBeenCalledTimes(3);
      observation.close();
      await reopen();
      await reopen();
      expect(reader).toHaveBeenCalledTimes(5);
    } finally {
      observation.close();
      client.clear();
    }
  });

  test.each([false, true])(
    "does not reuse a read completed after a live event with warm cache %s",
    async (warm) => {
      const client = new QueryClient();
      const observation = sessionHistoryCoverage(client).observe("/repo");
      observation.accept(createLiveSnapshotEnvelope({ sessions: [snapshot] }));
      const result = Promise.withResolvers<AgentSessionHistoryMessage[]>();
      const reader = mock(() => result.promise);
      const options = sessionHistoryQueryOptions(sessionRefFixture, reader, client);
      try {
        if (warm) {
          await client.fetchQuery(
            sessionHistoryQueryOptions(sessionRefFixture, async () => [], client),
          );
          await client.invalidateQueries({ queryKey: options.queryKey, refetchType: "none" });
        }
        const pending = client.fetchQuery(options);
        observation.accept({
          type: "session_upsert",
          session: { ...snapshot, activity: "running" },
        });
        result.resolve([{ ...historyMessageFixture }]);
        await pending;
        await client.fetchQuery(options);
        expect(reader).toHaveBeenCalledTimes(2);
        await client.fetchQuery(options);
        expect(reader).toHaveBeenCalledTimes(2);
      } finally {
        observation.close();
        client.clear();
      }
    },
  );
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
      client.fetchQuery(sessionHistoryQueryOptions(input, reader, client)),
      client.fetchQuery(sessionHistoryQueryOptions({ ...input }, reader, client)),
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
      sessionHistoryQueryOptions(sessionRefFixture, readSessionHistory, queryClient),
    );

    expect(history).toEqual([historyMessageFixture]);
    expect(readSessionHistory).toHaveBeenCalledWith(sessionRefFixture);
  });
});
