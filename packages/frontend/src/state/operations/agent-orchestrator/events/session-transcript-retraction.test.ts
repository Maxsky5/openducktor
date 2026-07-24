import { describe, expect, test } from "bun:test";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEvent,
  type SessionEventAdapter,
} from "./session-events-test-harness";

describe("agent-orchestrator transcript retraction", () => {
  test("removes subagent rows owned by a retracted assistant message", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_sessionRef, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession()]);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession: createSessionUpdater(sessionsRef),
      eventBatchWindowMs: 0,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      part: {
        kind: "subagent",
        messageId: "assistant-1",
        partId: "claude-subagent:task-1",
        correlationKey: "task-1",
        status: "running",
        agent: "general-purpose",
        description: "Inspect authentication",
      },
    });
    expect(getSessionMessages(sessionsRef).map((message) => message.id)).toEqual([
      "subagent:task-1",
    ]);

    handleEvent({
      type: "transcript_retracted",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      messageIds: ["assistant-1"],
    });

    expect(getSessionMessages(sessionsRef)).toEqual([]);
  });
});
