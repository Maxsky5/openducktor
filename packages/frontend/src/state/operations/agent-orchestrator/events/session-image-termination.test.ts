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
        output: { itemId: part.itemId, representation: "inline" },
      },
    });
    expect(getSessionMessages(sessionsRef)[0]?.meta).toMatchObject({ status: "completed" });
    consumer.close();
  });
}
