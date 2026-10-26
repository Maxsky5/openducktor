import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionHistoryMessage, LoadAgentSessionHistoryInput } from "@openducktor/core";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { createLiveSnapshotEnvelope } from "../test-support/agent-session-live-fixture";
import { getSessionHistoryFreshnessTracker } from "./agent-session-history-freshness-tracker";
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

  test("reuses current history on reopen and reads again after activity, a gap, or observation teardown", async () => {
    const client = new QueryClient();
    const observation = getSessionHistoryFreshnessTracker(client).observeWorkspace("/repo");
    observation.recordEvent(createLiveSnapshotEnvelope({ sessions: [snapshot] }));
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
      observation.recordEvent({
        type: "session_upsert",
        session: { ...snapshot, title: "Renamed chat" },
      });
      await reopen();
      expect(reader).toHaveBeenCalledTimes(1);
      observation.recordEvent({
        type: "session_upsert",
        session: { ...snapshot, ref: { ...snapshot.ref, externalSessionId: "other" } },
      });
      await reopen();
      expect(reader).toHaveBeenCalledTimes(1);
      observation.recordEvent({
        type: "session_upsert",
        session: { ...snapshot, activity: "running" },
      });
      await reopen();
      expect(reader).toHaveBeenCalledTimes(2);
      observation.recordEvent(
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

  test("resets histories after a repeated connection snapshot, not after a host refresh snapshot", () => {
    const client = new QueryClient();
    const freshnessTracker = getSessionHistoryFreshnessTracker(client);
    const resets: string[] = [];
    const unsubscribe = freshnessTracker.subscribeWorkspaceResets((repoPath) =>
      resets.push(repoPath),
    );
    const observation = freshnessTracker.observeWorkspace("/repo");
    try {
      observation.recordEvent(
        createLiveSnapshotEnvelope({ sessions: [snapshot], isConnectionSnapshot: true }),
      );
      // A host refresh pushes a snapshot on the same stream, so no event before it is missing.
      observation.recordEvent(
        createLiveSnapshotEnvelope({ sessions: [{ ...snapshot, activity: "running" }] }),
      );
      expect(resets).toEqual([]);
      observation.recordEvent(
        createLiveSnapshotEnvelope({ sessions: [snapshot], isConnectionSnapshot: true }),
      );
      expect(resets).toEqual(["/repo"]);
    } finally {
      unsubscribe();
      observation.close();
      client.clear();
    }
  });

  test.each([
    ["session_upsert", "new-parent"],
    ["session_upsert", undefined],
    ["task_session_records_updated", "new-parent"],
    ["task_session_records_updated", undefined],
  ] as const)(
    "refreshes both ancestor chains for %s with next parent %s",
    async (type, nextParent) => {
      const client = new QueryClient();
      const freshnessTracker = getSessionHistoryFreshnessTracker(client);
      const observation = freshnessTracker.observeWorkspace("/repo");
      const session = (externalSessionId: string, parentExternalSessionId?: string) => ({
        ...snapshot,
        ref: {
          repoPath: sessionRefFixture.repoPath,
          runtimeKind: sessionRefFixture.runtimeKind,
          workingDirectory: sessionRefFixture.workingDirectory,
          externalSessionId,
        },
        parentExternalSessionId,
      });
      const ancestor = session("ancestor");
      const oldParent = session("old-parent", "ancestor");
      const newParent = session("new-parent", "ancestor");
      const child = session("child", "old-parent");
      const peer = session("peer");
      const initial = createLiveSnapshotEnvelope({
        sessions: [ancestor, oldParent, newParent, child, peer],
      });
      observation.recordEvent(initial);
      const historyProgress = freshnessTracker.createHistoryProgressTracker();
      historyProgress.recordEvent(initial);
      const histories = [oldParent, newParent, ancestor, peer].map((entry) => {
        const reader = mock(async () => [historyMessageFixture]);
        historyProgress.captureReadVersion("/repo", entry.ref);
        return {
          ref: entry.ref,
          reader,
          options: sessionHistoryQueryOptions(
            { ...sessionRefFixture, ...entry.ref },
            reader,
            client,
          ),
        };
      });
      const reopen = () => Promise.all(histories.map(({ options }) => client.fetchQuery(options)));
      try {
        await reopen();
        const updated = { ...child, parentExternalSessionId: nextParent };
        const envelope: AgentSessionLiveEnvelope =
          type === "session_upsert"
            ? { type, sequence: 1, session: updated }
            : {
                type,
                sequence: 1,
                repoPath: "/repo",
                taskId: "task-1",
                agentSessions: [],
                liveSession: updated,
              };
        observation.recordEvent(envelope);
        for (const { ref } of histories) {
          const affected =
            ref.externalSessionId === "old-parent" ||
            ref.externalSessionId === "ancestor" ||
            ref.externalSessionId === nextParent;
          // A selected attachment that has not applied the update cannot retain these histories.
          expect(freshnessTracker.isCurrent("/repo", ref, historyProgress.getVersion(ref))).toBe(
            !affected,
          );
        }
        await reopen();
        expect(histories.map(({ reader }) => reader.mock.calls.length)).toEqual([
          2,
          nextParent ? 2 : 1,
          2,
          1,
        ]);
        historyProgress.recordEvent(structuredClone(envelope));
        for (const { ref } of histories) {
          expect(freshnessTracker.isCurrent("/repo", ref, historyProgress.getVersion(ref))).toBe(
            true,
          );
        }
        observation.recordEvent({
          type: "transcript_event",
          sequence: 2,
          event: {
            type: "assistant_message",
            sessionRef: child.ref,
            externalSessionId: child.ref.externalSessionId,
            timestamp: "2026-02-22T12:00:01.000Z",
            messageId: "child-message",
            message: "Child update",
          },
        });
        await reopen();
        // Later child updates follow the new lineage and leave the old parent and peer cached.
        expect(histories.map(({ reader }) => reader.mock.calls.length)).toEqual([
          2,
          nextParent ? 3 : 1,
          nextParent ? 3 : 2,
          1,
        ]);
      } finally {
        observation.close();
        client.clear();
      }
    },
  );

  test.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "does not reuse a raced read with warm cache %s and prior unsequenced fault %s",
    async (warm, priorFault) => {
      const client = new QueryClient();
      const observation = getSessionHistoryFreshnessTracker(client).observeWorkspace("/repo");
      observation.recordEvent(createLiveSnapshotEnvelope({ sessions: [snapshot] }));
      const transcript = (sequence: number) =>
        ({
          type: "transcript_event",
          sequence,
          event: {
            type: "assistant_message",
            sessionRef: snapshot.ref,
            externalSessionId: snapshot.ref.externalSessionId,
            timestamp: "2026-02-22T12:00:01.000Z",
            messageId: `live-${sequence}`,
            message: `Live ${sequence}`,
          },
        }) as const;
      if (priorFault) {
        observation.recordEvent(transcript(1));
        observation.recordEvent({
          type: "fault",
          repoPath: "/repo",
          ref: snapshot.ref,
          message: "Read failed",
        });
      }
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
        observation.recordEvent(
          priorFault
            ? transcript(2)
            : { type: "session_upsert", session: { ...snapshot, activity: "running" } },
        );
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
