import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope, AgentSessionTranscriptEvent } from "@openducktor/contracts";
import { getAgentSession } from "@/state/agent-session-collection";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { applyAgentSessionLiveDelta } from "../session-read-model/agent-session-live-projection";
import { loadSessionHistoryIntoStore } from "../history/session-history-loader";
import { createSessionHistoryReadGeneration } from "../history/session-history-read-generation";
import { createSessionTurnState } from "../support/session-turn-state";
import type { UpdateSession } from "./session-event-types";
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
  const guardedUpdateSession: UpdateSession = (identity, updater) =>
    updateSession(identity, updater);
  const consumer = createAgentSessionTranscriptEventConsumer(
    {
      readSession: (identity) => getAgentSession(sessionsRef.current, identity),
      ensureSession: (identity, createSession) => {
        const current = getAgentSession(sessionsRef.current, identity);
        return current ?? createSession();
      },
      updateSession: guardedUpdateSession,
      updateSessionTodos: () => undefined,
      sessionTurnState: createSessionTurnState(),
    },
    { batchWindowMs },
  );
  return {
    consumer: {
      ...consumer,
      handle: (event: AgentSessionTranscriptEvent, provenance?: "baseline" | "live") => {
        const envelope: Extract<AgentSessionLiveEnvelope, { type: "transcript_event" }> = {
          type: "transcript_event",
          event,
        };
        if (provenance) envelope.provenance = provenance;
        sessionsRef.current = applyAgentSessionLiveDelta({
          current: sessionsRef.current,
          envelope,
        });
        consumer.handle(event, provenance);
      },
    },
    sessionsRef,
  };
};

describe("agent session transcript event consumer", () => {
  test("restores a past interruption without clearing a current stop request", () => {
    const liveRef = { ...sessionRef, runtimeKind: "opencode" as const };
    const stopRequestedAt = "2026-10-10T08:00:10.000Z";
    const { consumer, sessionsRef } = createConsumerHarness(
      0,
      buildSession({
        runtimeKind: "opencode",
        status: "running",
        stopRequestedAt,
        pendingQuestions: [{ requestId: "current-question", questions: [] }],
      }),
    );
    try {
      consumer.handle(
        {
          type: "session_idle",
          sessionRef: liveRef,
          externalSessionId: liveRef.externalSessionId,
          timestamp: "2026-10-10T07:00:10.000Z",
          interruption: { messageId: "previous-stop", message: "Turn interrupted." },
        },
        "baseline",
      );
      expect(getSession(sessionsRef)).toMatchObject({
        status: "running",
        stopRequestedAt,
        pendingQuestions: [{ requestId: "current-question", questions: [] }],
      });
      expect(getSessionMessages(sessionsRef)).toContainEqual({
        id: "previous-stop",
        role: "system",
        timestamp: "2026-10-10T07:00:10.000Z",
        content: "Turn interrupted.",
        meta: {
          kind: "session_notice",
          tone: "cancelled",
          reason: "session_interrupted",
          title: "Interrupted",
        },
      });
    } finally {
      consumer.close();
    }
  });

  test("orders a consumed OpenCode inbox message after native profile reminders", () => {
    const liveRef = { ...sessionRef, runtimeKind: "opencode" as const };
    const { consumer, sessionsRef } = createConsumerHarness(
      60_000,
      buildSession({ runtimeKind: "opencode" }),
    );
    const queued: Extract<AgentSessionTranscriptEvent, { type: "user_message" }> = {
      type: "user_message",
      externalSessionId: liveRef.externalSessionId,
      sessionRef: liveRef,
      messageId: "user-queued",
      timestamp: "2026-10-09T06:04:17.225Z",
      message: "Read-only verification",
      parts: [{ kind: "text", text: "Read-only verification" }],
      state: "queued",
    };
    try {
      consumer.handle(queued);
      for (const reminder of [
        {
          messageId: "plan-enter",
          timestamp: "2026-10-09T06:04:17.241Z",
          message: "Enter Plan mode.",
        },
        {
          messageId: "plan-leave",
          timestamp: "2026-10-09T06:04:17.243Z",
          message: "Leave Plan mode.",
        },
      ]) {
        consumer.handle({
          type: "session_policy_notice",
          externalSessionId: liveRef.externalSessionId,
          sessionRef: liveRef,
          ...reminder,
        });
      }
      consumer.handle({ ...queued, state: "read", timestamp: "2026-10-09T06:04:17.244Z" });
      expect(getSessionMessages(sessionsRef).map((message) => message.id)).toEqual([
        "plan-enter",
        "plan-leave",
        "user-queued",
      ]);
      expect(getSessionMessages(sessionsRef).at(-1)).toMatchObject({
        timestamp: "2026-10-09T06:04:17.244Z",
        meta: { kind: "user", state: "read" },
      });
    } finally {
      consumer.close();
    }
  });

  test("keeps OpenCode agent selection notices as ordinary system messages", () => {
    const liveRef = { ...sessionRef, runtimeKind: "opencode" as const };
    const { consumer, sessionsRef } = createConsumerHarness(
      60_000,
      buildSession({ runtimeKind: "opencode" }),
    );
    const before = getSession(sessionsRef).status;
    try {
      consumer.handle({
        type: "session_policy_notice",
        externalSessionId: liveRef.externalSessionId,
        sessionRef: liveRef,
        timestamp: "2026-10-08T10:00:00Z",
        messageId: "agent-selected",
        message: "Agent selected: build",
      });
      const notice = getSessionMessages(sessionsRef).find(
        (message) => message.id === "agent-selected",
      );
      expect(notice).toMatchObject({ role: "system", content: "Agent selected: build" });
      expect(notice?.meta).toBeUndefined();
      expect(getSession(sessionsRef).status).toBe(before);
    } finally {
      consumer.close();
    }
  });

  test("updates Claude permission mismatch warnings in place without changing session activity", () => {
    const liveRef = { ...sessionRef, runtimeKind: "claude" as const };
    const { consumer, sessionsRef } = createConsumerHarness(
      60_000,
      buildSession({ runtimeKind: "claude" }),
    );
    const before = getSession(sessionsRef).status;
    try {
      for (const message of [
        "Claude permission mode 'auto' was requested, but Claude reports 'default'. Check your Claude permission settings.",
        "Claude permission mode 'auto' was requested, but Claude reports 'acceptEdits'. Check your Claude permission settings.",
      ])
        consumer.handle({
          type: "session_policy_notice",
          externalSessionId: liveRef.externalSessionId,
          sessionRef: liveRef,
          timestamp: "2026-10-03T10:00:00Z",
          messageId: "policy",
          message,
        });
      expect(getSessionMessages(sessionsRef).filter((message) => message.id === "policy")).toEqual([
        expect.objectContaining({
          role: "system",
          content:
            "Claude permission mode 'auto' was requested, but Claude reports 'acceptEdits'. Check your Claude permission settings.",
          meta: {
            kind: "session_notice",
            tone: "warning",
            reason: "runtime_policy",
            title: "Claude permission mode mismatch",
          },
        }),
      ]);
      expect(getSession(sessionsRef).status).toBe(before);
    } finally {
      consumer.close();
    }
  });

  for (const runtimeKind of ["opencode", "codex", "claude"] as const) {
    for (const batchWindowMs of [0, 60_000]) {
      test(`keeps concurrent ${runtimeKind} reads in call order with a ${batchWindowMs} ms batch`, async () => {
        const liveRef = { ...sessionRef, runtimeKind };
        const { consumer, sessionsRef } = createConsumerHarness(
          batchWindowMs,
          buildSession({ runtimeKind, historyLoadState: "loaded" }),
        );
        const tools = ["first", "second", "third"].map((name, index) => ({
          kind: "tool" as const,
          messageId: "assistant-reads",
          partId: `read-${name}`,
          callId: `call-${name}`,
          tool: "read",
          toolType: "read" as const,
          status: "running" as const,
          input: { filePath: `/${name}.ts` },
          startedAtMs: Date.parse(`2026-10-02T11:57:55.00${index}Z`),
        }));
        try {
          for (const part of tools) {
            consumer.handle({
              type: "assistant_part",
              externalSessionId: liveRef.externalSessionId,
              sessionRef: liveRef,
              timestamp: new Date(part.startedAtMs).toISOString(),
              part,
            });
          }
          for (const [index, part] of [...tools].reverse().entries()) {
            consumer.handle({
              type: "assistant_part",
              externalSessionId: liveRef.externalSessionId,
              sessionRef: liveRef,
              timestamp: `2026-10-02T11:57:55.01${index}Z`,
              part: { ...part, status: "completed", output: part.input.filePath },
            });
          }
          consumer.handle({
            type: "session_idle",
            externalSessionId: liveRef.externalSessionId,
            sessionRef: liveRef,
            timestamp: "2026-10-02T11:57:55.020Z",
          });
          const callOrder = tools.map((part) => `tool:${part.messageId}:${part.callId}`);
          const liveMessages = getSessionMessages(sessionsRef);
          expect(liveMessages.map((message) => message.id)).toEqual(callOrder);
          expect(liveMessages.map((message) => message.timestamp)).toEqual(
            tools.map((part) => new Date(part.startedAtMs).toISOString()),
          );
          expect(
            liveMessages.map(
              (message) => message.meta?.kind === "tool" && message.meta.observedEndedAtMs,
            ),
          ).toEqual([
            Date.parse("2026-10-02T11:57:55.012Z"),
            Date.parse("2026-10-02T11:57:55.011Z"),
            Date.parse("2026-10-02T11:57:55.010Z"),
          ]);

          createSessionUpdater(sessionsRef)(liveRef, (current) => ({
            ...current,
            historyLoadState: "stale",
          }));
          await loadSessionHistoryIntoStore({
            repoPath: liveRef.repoPath,
            identity: liveRef,
            loadSettingsSnapshot: async () => createSettingsSnapshotFixture(),
            adapter: {
              loadSessionHistory: async () => [
                {
                  messageId: "assistant-reads",
                  role: "assistant",
                  timestamp: "2026-10-02T11:57:55.000Z",
                  text: "",
                  parts: tools.map((part, index) => ({
                    ...part,
                    status: "completed",
                    output: part.input.filePath,
                    endedAtMs: Date.parse(`2026-10-02T11:57:55.01${2 - index}Z`),
                  })),
                },
              ],
            },
            readSessionSnapshot: (identity) => getAgentSession(sessionsRef.current, identity),
            updateSession: createSessionUpdater(sessionsRef),
            isStaleRepoOperation: () => false,
            historyReadGeneration: createSessionHistoryReadGeneration(),
          });
          const loadedMessages = getSessionMessages(sessionsRef);
          expect(getSession(sessionsRef).historyLoadState).toBe("loaded");
          expect(loadedMessages.map((message) => message.id)).toEqual(callOrder);
          expect(
            loadedMessages.map(
              (message) => message.meta?.kind === "tool" && message.meta.endedAtMs,
            ),
          ).toEqual(
            liveMessages.map(
              (message) => message.meta?.kind === "tool" && message.meta.observedEndedAtMs,
            ),
          );
        } finally {
          consumer.close();
        }
      });
    }
  }

  test("keeps a completed read before a pending read with the same first timestamp", () => {
    const { consumer, sessionsRef } = createConsumerHarness(60_000);
    const parts = ["first", "second"].map((name) => ({
      kind: "tool" as const,
      messageId: "assistant-reads",
      partId: `read-${name}`,
      callId: `call-${name}`,
      tool: "read",
      toolType: "read" as const,
      status: "pending" as const,
    }));
    try {
      for (const part of parts) {
        consumer.handle({
          type: "assistant_part",
          externalSessionId: sessionRef.externalSessionId,
          sessionRef,
          timestamp: "2026-10-02T11:57:55.000Z",
          part,
        });
      }
      consumer.handle({
        type: "assistant_part",
        externalSessionId: sessionRef.externalSessionId,
        sessionRef,
        timestamp: "2026-10-02T11:57:55.010Z",
        part: { ...parts[0]!, status: "completed", output: "First file" },
      });
      consumer.flushSession(sessionRef);
      expect(getSessionMessages(sessionsRef)).toMatchObject([
        { id: "tool:assistant-reads:call-first", meta: { status: "completed" } },
        { id: "tool:assistant-reads:call-second", meta: { status: "pending" } },
      ]);
    } finally {
      consumer.close();
    }
  });

  test("keeps text before its tool when text completion shares the event batch", () => {
    const liveRef = { ...sessionRef, runtimeKind: "opencode" as const };
    const { consumer, sessionsRef } = createConsumerHarness(
      60_000,
      buildSession({ runtimeKind: "opencode" }),
    );
    try {
      const textPart = {
        kind: "text",
        messageId: "assistant-1",
        partId: "text-1",
        text: "Before the tool",
        completed: false,
      } as const;
      consumer.handle({
        type: "assistant_part",
        externalSessionId: liveRef.externalSessionId,
        sessionRef: liveRef,
        timestamp: "2026-10-02T11:57:55.603Z",
        part: { ...textPart, text: "" },
      });
      consumer.handle({
        type: "assistant_part",
        externalSessionId: liveRef.externalSessionId,
        sessionRef: liveRef,
        timestamp: "2026-10-02T11:57:55.603Z",
        part: textPart,
      });
      consumer.handle({
        type: "assistant_part",
        externalSessionId: liveRef.externalSessionId,
        sessionRef: liveRef,
        timestamp: "2026-10-02T11:57:55.714Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "bash",
          toolType: "bash",
          status: "running",
          input: { command: "sleep 6" },
        },
      });
      consumer.handle({
        type: "assistant_part",
        externalSessionId: liveRef.externalSessionId,
        sessionRef: liveRef,
        timestamp: "2026-10-02T11:57:55.914Z",
        part: { ...textPart, completed: true },
      });

      expect(getSessionMessages(sessionsRef).map((message) => message.id)).toEqual([
        "text:assistant-1:text-1",
        "tool:assistant-1:call-1",
      ]);
    } finally {
      consumer.close();
    }
  });

  test("a buffered transcript part cannot overwrite a later terminal episode", () => {
    const { consumer, sessionsRef } = createConsumerHarness(60_000);
    consumer.handle({
      type: "assistant_delta",
      channel: "text",
      messageId: "late-message",
      delta: "Buffered output",
      externalSessionId: "session-1",
      timestamp: "2026-09-12T12:00:00Z",
      sessionRef,
    });
    sessionsRef.current = applyAgentSessionLiveDelta({
      current: sessionsRef.current,
      envelope: {
        type: "transcript_event",
        event: {
          type: "session_error",
          externalSessionId: "session-1",
          message: "New episode failed",
          timestamp: "2026-09-12T12:00:01Z",
          sessionRef,
        },
      },
    });
    consumer.close();
    expect(getSession(sessionsRef).status).toBe("error");
  });
  test("keeps child messages in the shared projection independently of modal lifetime", () => {
    const child = buildSession({
      externalSessionId: "child-thread",
      sessionAssociation: { kind: "unbound" },
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

  test("does not persist child session errors as workflow sessions", () => {
    const child = buildSession({
      externalSessionId: "child-thread",
      sessionAssociation: { kind: "unbound" },
      runtimeKind: "claude",
    });
    const { consumer, sessionsRef } = createConsumerHarness(0, child);

    expect(() =>
      consumer.handle({
        type: "session_error",
        externalSessionId: "child-thread",
        timestamp: "2026-07-17T08:00:01.000Z",
        message: "Child runtime failed",
        sessionRef: { ...sessionRef, runtimeKind: "claude", externalSessionId: "child-thread" },
      }),
    ).not.toThrow();
    expect(getSession(sessionsRef, "child-thread").status).toBe("error");
    consumer.close();
  });

  for (const runtimeKind of ["codex", "opencode"] as const) {
    test(`flushes the final ${runtimeKind} child message before the terminal event`, () => {
      const childRef = { ...sessionRef, runtimeKind, externalSessionId: "child-thread" };
      const child = buildSession({
        externalSessionId: "child-thread",
        sessionAssociation: { kind: "unbound" },
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

  test("keeps the final Claude child output and tool timing when live removal wins the race", () => {
    const childRef = {
      ...sessionRef,
      runtimeKind: "claude" as const,
      externalSessionId: "child-thread",
    };
    const child = buildSession({
      externalSessionId: "child-thread",
      sessionAssociation: { kind: "unbound" },
      runtimeKind: "claude",
      status: "running",
    });
    const { consumer, sessionsRef } = createConsumerHarness(60_000, child);

    consumer.handle({
      type: "assistant_part",
      externalSessionId: "child-thread",
      timestamp: "2026-07-17T08:00:01.000Z",
      sessionRef: childRef,
      part: {
        kind: "tool",
        messageId: "assistant-child-1",
        partId: "read-1",
        callId: "read-1",
        tool: "Read",
        toolType: "read",
        status: "completed",
        startedAtMs: 100,
        endedAtMs: 160,
      },
    });
    consumer.handle({
      type: "assistant_message",
      externalSessionId: "child-thread",
      messageId: "assistant-child-final",
      message: "Child result",
      timestamp: "2026-07-17T08:00:02.000Z",
      sessionRef: childRef,
    });
    sessionsRef.current = applyAgentSessionLiveDelta({
      current: sessionsRef.current,
      envelope: { type: "session_removed", ref: childRef },
    });
    consumer.handle({
      type: "session_finished",
      externalSessionId: "child-thread",
      message: "Session finished",
      timestamp: "2026-07-17T08:00:03.000Z",
      sessionRef: childRef,
    });

    expect(getSessionMessages(sessionsRef, "child-thread")).toEqual([
      expect.objectContaining({
        role: "tool",
        meta: expect.objectContaining({ startedAtMs: 100, endedAtMs: 160 }),
      }),
      expect.objectContaining({ role: "assistant", content: "Child result" }),
    ]);
    consumer.close();
  });
});
