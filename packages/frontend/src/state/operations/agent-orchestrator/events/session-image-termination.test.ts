import { expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { getAgentSession } from "@/state/agent-session-collection";
import { applyLoadedSessionHistory } from "../support/session-history-chat-messages";
import { createSessionTurnState } from "../support/session-turn-state";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSession,
  getSessionMessages,
} from "./session-events-test-harness";
import { createAgentSessionTranscriptEventConsumer } from "./session-transcript-events";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/tmp/repo",
  externalSessionId: "session-1",
};
const timestamp = "2026-09-06T10:00:00.000Z";
const history: AgentSessionHistoryMessage[] = [
  {
    messageId: "image",
    role: "assistant",
    text: "",
    timestamp,
    parts: [
      {
        kind: "image_generation",
        itemId: "image",
        messageId: "image",
        partId: "image",
        turnId: "turn",
        status: "running",
      },
    ],
  },
];

for (const type of ["session_idle", "session_error", "session_finished"] as const) {
  for (const order of ["history-first", "terminal-first"] as const) {
    test(`${type} settles history-only images with ${order} delivery`, () => {
      const sessionsRef = createSessionsRef([
        buildSession({ runtimeKind: "codex", status: "running" }),
      ]);
      const updateSession = createSessionUpdater(sessionsRef);
      const consumer = createAgentSessionTranscriptEventConsumer(
        {
          readSession: (identity) => getAgentSession(sessionsRef.current, identity),
          ensureSession: (_identity, create) => create(),
          updateSession,
          updateSessionTodos: () => {},
          sessionTurnState: createSessionTurnState(),
        },
        { batchWindowMs: 0 },
      );
      const load = () =>
        updateSession(ref, (current) => applyLoadedSessionHistory(current, history));
      if (order === "history-first") load();
      consumer.handle({
        type,
        externalSessionId: ref.externalSessionId,
        sessionRef: ref,
        timestamp,
        message: "Runtime stopped",
      });
      const activity = getSession(sessionsRef).status;
      if (order === "terminal-first") load();
      expect(
        getSessionMessages(sessionsRef).find((message) => message.meta?.kind === "image_generation")
          ?.meta,
      ).toMatchObject({ status: "incomplete" });
      expect(getSession(sessionsRef).status).toBe(activity);
      consumer.close();
    });
  }
}

for (const order of ["history-first", "terminal-first"] as const) {
  test(`image turn settlement crosses the host/renderer boundary with ${order} delivery`, () => {
    const sessionsRef = createSessionsRef([
      buildSession({ runtimeKind: "codex", status: "running" }),
    ]);
    const updateSession = createSessionUpdater(sessionsRef);
    const consumer = createAgentSessionTranscriptEventConsumer(
      {
        readSession: (identity) => getAgentSession(sessionsRef.current, identity),
        ensureSession: (_identity, create) => create(),
        updateSession,
        updateSessionTodos: () => {},
        sessionTurnState: createSessionTurnState(),
      },
      { batchWindowMs: 0 },
    );
    const load = () => updateSession(ref, (current) => applyLoadedSessionHistory(current, history));
    if (order === "history-first") load();
    consumer.handle({
      type: "image_generation_settled",
      externalSessionId: ref.externalSessionId,
      sessionRef: ref,
      timestamp,
      turnId: "turn",
      reason: "interrupted",
    });
    expect(getSession(sessionsRef).status).toBe("running");
    consumer.handle({
      type: "session_idle",
      externalSessionId: ref.externalSessionId,
      sessionRef: ref,
      timestamp,
    });
    if (order === "terminal-first") load();
    updateSession(ref, (current) => applyLoadedSessionHistory(current, history));
    expect(getSessionMessages(sessionsRef)[0]?.meta).toMatchObject({ status: "interrupted" });
    expect(getSession(sessionsRef).status).toBe("idle");
    const part = history[0]?.parts[0];
    if (part?.kind !== "image_generation") throw new Error("Missing image fixture");
    consumer.handle({
      type: "assistant_part",
      externalSessionId: ref.externalSessionId,
      sessionRef: ref,
      timestamp,
      part: { ...part, turnId: "new-turn" },
    });
    expect(getSessionMessages(sessionsRef).at(-1)?.meta).toMatchObject({
      status: "running",
      turnId: "new-turn",
    });
    consumer.handle({
      type: "assistant_part",
      externalSessionId: ref.externalSessionId,
      sessionRef: ref,
      timestamp,
      part: {
        ...part,
        status: "completed",
        output: { revision: "output-v1" },
      },
    });
    expect(getSessionMessages(sessionsRef)[0]?.meta).toMatchObject({ status: "completed" });
    consumer.close();
  });
}

test("session-wide idle settles late history whose timestamp was synthesized at load time", () => {
  const sessionsRef = createSessionsRef([
    buildSession({ runtimeKind: "codex", status: "running" }),
  ]);
  const updateSession = createSessionUpdater(sessionsRef);
  const consumer = createAgentSessionTranscriptEventConsumer(
    {
      readSession: (identity) => getAgentSession(sessionsRef.current, identity),
      ensureSession: (_identity, create) => create(),
      updateSession,
      updateSessionTodos: () => {},
      sessionTurnState: createSessionTurnState(),
    },
    { batchWindowMs: 0 },
  );
  try {
    consumer.handle({
      type: "image_generation_settled",
      externalSessionId: ref.externalSessionId,
      sessionRef: ref,
      timestamp,
      reason: "turn_ended",
    });
    const before = getSession(sessionsRef);
    const loadedAt = "2026-09-06T10:00:01.000Z";
    updateSession(ref, (current) =>
      applyLoadedSessionHistory(
        current,
        history.map((message) => ({
          ...message,
          timestamp: loadedAt,
          timestampIsApproximate: true,
        })),
      ),
    );
    expect(getSessionMessages(sessionsRef)[0]?.meta).toMatchObject({
      status: "incomplete",
      incompleteReason: "turn_ended",
    });
    expect(getSession(sessionsRef).status).toBe(before.status);
    expect(getSession(sessionsRef).pendingApprovals).toEqual(before.pendingApprovals);
    expect(getSession(sessionsRef).pendingQuestions).toEqual(before.pendingQuestions);
  } finally {
    consumer.close();
  }
});

test("confirmed turns isolate old and new nullable-timestamp history across global ends", () => {
  const sessionsRef = createSessionsRef([
    buildSession({ runtimeKind: "codex", status: "running" }),
  ]);
  const updateSession = createSessionUpdater(sessionsRef);
  const consumer = createAgentSessionTranscriptEventConsumer(
    {
      readSession: (identity) => getAgentSession(sessionsRef.current, identity),
      ensureSession: (_identity, create) => create(),
      updateSession,
      updateSessionTodos: () => {},
      sessionTurnState: createSessionTurnState(),
    },
    { batchWindowMs: 0 },
  );
  const eventBase = { externalSessionId: ref.externalSessionId, sessionRef: ref, timestamp };
  const part = history[0]?.parts[0];
  if (part?.kind !== "image_generation") throw new Error("Missing image fixture");
  const unknownTimeHistory: AgentSessionHistoryMessage[] = ["turn", "next"].map((turnId) => ({
    messageId: `image-${turnId}`,
    role: "assistant",
    text: "",
    timestamp: "2026-09-06T10:00:02.000Z",
    timestampIsApproximate: true,
    parts: [{ ...part, itemId: `image-${turnId}`, turnId }],
  }));
  try {
    consumer.handle({ ...eventBase, type: "image_generation_turn_started", turnId: "turn" });
    consumer.handle({ ...eventBase, type: "image_generation_settled", reason: "turn_ended" });
    consumer.handle({ ...eventBase, type: "image_generation_turn_started", turnId: "next" });
    const beforeHistory = getSession(sessionsRef);
    updateSession(ref, (current) => applyLoadedSessionHistory(current, unknownTimeHistory));
    expect(getSessionMessages(sessionsRef).map((message) => message.meta)).toMatchObject([
      { turnId: "turn", status: "incomplete" },
      { turnId: "next", status: "running" },
    ]);
    expect(getSession(sessionsRef).status).toBe(beforeHistory.status);
    consumer.handle({
      ...eventBase,
      type: "image_generation_settled",
      reason: "runtime_failure",
      timestamp: "2026-09-06T10:00:01.000Z",
    });
    consumer.handle({ ...eventBase, type: "image_generation_turn_started", turnId: "next" });
    updateSession(ref, (current) => applyLoadedSessionHistory(current, unknownTimeHistory));
    expect(getSessionMessages(sessionsRef).map((message) => message.meta)).toMatchObject([
      { turnId: "turn", status: "incomplete" },
      { turnId: "next", status: "incomplete" },
    ]);
  } finally {
    consumer.close();
  }
});
