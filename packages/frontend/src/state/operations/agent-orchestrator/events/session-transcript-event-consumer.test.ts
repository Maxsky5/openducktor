import { describe, expect, test } from "bun:test";
import type { AgentSessionTranscriptEvent } from "@openducktor/contracts";
import { getAgentSession } from "@/state/agent-session-collection";
import { createSessionTurnState } from "../support/session-turn-state";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSession,
  getSessionMessages,
} from "./session-events-test-harness";
import { createAgentSessionTranscriptEventConsumer } from "./session-transcript-events";

const sessionRef = {
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/tmp/repo",
  externalSessionId: "session-1",
} as const;

const createConsumerHarness = (
  batchWindowMs = 0,
  session = buildSession({ runtimeKind: "codex" }),
) => {
  const sessionsRef = createSessionsRef([session]);
  const updateSession = createSessionUpdater(sessionsRef);
  const consumer = createAgentSessionTranscriptEventConsumer(
    {
      readSession: (identity) => getAgentSession(sessionsRef.current, identity),
      ensureSession: (identity, createSession) => {
        const current = getAgentSession(sessionsRef.current, identity);
        return current ?? createSession();
      },
      updateSession,
      updateSessionTodos: () => undefined,
      sessionTurnState: createSessionTurnState(),
    },
    { batchWindowMs },
  );
  return { consumer, sessionsRef };
};

describe("agent session transcript event consumer", () => {
  test("keeps child messages in the shared projection independently of modal lifetime", () => {
    const child = buildSession({
      externalSessionId: "child-thread",
      role: null,
      runtimeKind: "codex",
    });
    const { consumer, sessionsRef } = createConsumerHarness(0, child);

    consumer.handle({
      type: "assistant_message",
      externalSessionId: "child-thread",
      messageId: "assistant-child-1",
      message: "Visible after reopening",
      timestamp: "2026-07-17T08:00:00.000Z",
      sessionRef: { ...sessionRef, externalSessionId: "child-thread" },
    });

    expect(getSessionMessages(sessionsRef, "child-thread")).toEqual([
      expect.objectContaining({ content: "Visible after reopening" }),
    ]);
    consumer.close();
  });

  test("applies lifecycle status and error details from the production live stream", () => {
    const { consumer, sessionsRef } = createConsumerHarness();

    consumer.handle({
      type: "session_status",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T08:00:00.000Z",
      status: {
        type: "retry",
        attempt: 2,
        message: "Runtime overloaded",
        nextEpochMs: 123,
      },
      sessionRef,
    } satisfies AgentSessionTranscriptEvent);
    expect(getSessionMessages(sessionsRef).map((message) => message.content)).toEqual([
      "Retry 2: Runtime overloaded",
    ]);

    consumer.handle({
      type: "session_error",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T08:00:01.000Z",
      message: "Child runtime failed",
      sessionRef,
    } satisfies AgentSessionTranscriptEvent);

    expect(getSession(sessionsRef).status).toBe("error");
    expect(getSessionMessages(sessionsRef).at(-1)?.content).toContain("Child runtime failed");
    consumer.close();
  });

  for (const runtimeKind of ["codex", "opencode"] as const) {
    test(`flushes the final ${runtimeKind} child message before the terminal event`, () => {
      const childRef = { ...sessionRef, runtimeKind, externalSessionId: "child-thread" };
      const child = buildSession({
        externalSessionId: "child-thread",
        role: null,
        runtimeKind,
      });
      const { consumer, sessionsRef } = createConsumerHarness(60_000, child);

      consumer.handle({
        type: "assistant_message",
        externalSessionId: "child-thread",
        messageId: "assistant-child-2",
        message: "New output while the transcript stays open",
        timestamp: "2026-07-17T08:00:00.000Z",
        sessionRef: childRef,
      });
      consumer.handle({
        type: "session_idle",
        externalSessionId: "child-thread",
        timestamp: "2026-07-17T08:00:01.000Z",
        sessionRef: childRef,
      } satisfies AgentSessionTranscriptEvent);

      expect(getSessionMessages(sessionsRef, "child-thread")).toEqual([
        expect.objectContaining({ content: "New output while the transcript stays open" }),
      ]);
      consumer.close();
    });
  }
});
