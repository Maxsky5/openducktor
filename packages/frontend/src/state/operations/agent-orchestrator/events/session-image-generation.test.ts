import { expect, test } from "bun:test";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
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

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/tmp/repo",
  externalSessionId: "session-1",
};
const part = (status: AgentImageGenerationPart["status"]): AgentImageGenerationPart => ({
  kind: "image_generation",
  itemId: "image",
  messageId: "image",
  partId: "image",
  turnId: "turn",
  status,
});

test("production event projection preserves terminal images without changing activity or pending input", () => {
  const session = buildSession({
    runtimeKind: "codex",
    status: "idle",
    pendingUserMessageStartedAt: 123,
  });
  const sessionsRef = createSessionsRef([session]);
  const consumer = createAgentSessionTranscriptEventConsumer(
    {
      readSession: (identity) => getAgentSession(sessionsRef.current, identity),
      ensureSession: (_identity, create) => create(),
      updateSession: createSessionUpdater(sessionsRef),
      updateSessionTodos: () => {
        throw new Error("Image events must not mutate todos");
      },
      sessionTurnState: createSessionTurnState(),
    },
    { batchWindowMs: 0 },
  );
  for (const status of ["running", "incomplete", "completed", "running"] as const) {
    consumer.handle({
      type: "assistant_part",
      externalSessionId: ref.externalSessionId,
      sessionRef: ref,
      timestamp: "2026-09-06T10:00:00.000Z",
      part: part(status),
    });
  }
  expect(getSessionMessages(sessionsRef)).toHaveLength(1);
  expect(getSessionMessages(sessionsRef)[0]?.meta).toMatchObject({
    kind: "image_generation",
    status: "completed",
  });
  expect(getSession(sessionsRef).status).toBe("idle");
  expect(getSession(sessionsRef).pendingUserMessageStartedAt).toBe(123);
  consumer.handle({
    type: "assistant_message",
    externalSessionId: ref.externalSessionId,
    sessionRef: ref,
    timestamp: "2026-09-06T10:01:00.000Z",
    messageId: "following",
    message: "Here is your image",
  });
  expect(getSessionMessages(sessionsRef).at(-1)?.content).toBe("Here is your image");
  consumer.close();
});
