import { expect, test } from "bun:test";
import type { AgentSessionTranscriptEvent } from "@openducktor/contracts";
import { Effect } from "effect";
import { createMemoryAgentSessionTurnStore } from "../../ports/agent-session-turn-store.test-support";
import { agentSessionMessageFingerprint } from "../../domain/agent-session-message-fingerprint";
import { createAgentSessionTurnRecorder } from "./agent-session-turn-recorder";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "session-1",
};
const model = { runtimeKind: "codex" as const, providerId: "openai", modelId: "gpt" };

/** A transcript event without the fields that `send` adds. */
type TranscriptEventInput = AgentSessionTranscriptEvent extends infer Event
  ? Event extends AgentSessionTranscriptEvent
    ? Omit<Event, "externalSessionId" | "sessionRef" | "timestamp">
    : never
  : never;

const setup = (workspaceId: string | null = "workspace-1") => {
  const memory = createMemoryAgentSessionTurnStore();
  const recorder = createAgentSessionTurnRecorder(memory.store);
  const send = (input: TranscriptEventInput, seconds: number) => {
    const event: AgentSessionTranscriptEvent = {
      ...input,
      externalSessionId: ref.externalSessionId,
      sessionRef: ref,
      timestamp: new Date(seconds * 1000).toISOString(),
    };
    return Effect.runPromise(
      event.type === "user_message" ? recorder.start(event, workspaceId) : recorder.observe(event),
    );
  };
  const turns = () => Effect.runPromise(memory.store.listTurns(ref));
  return { send, turns, recorder };
};

test("saves each accepted message and the end of the run on its last message", async () => {
  const { send, turns } = setup();
  await send(
    { type: "user_message", messageId: "u1", message: "Hi", parts: [], state: "read", model },
    2,
  );
  await send({ type: "user_message", messageId: "u1", message: "Hi", parts: [], state: "read" }, 3);
  await send(
    { type: "user_message", messageId: "u2", message: "Also", parts: [], state: "read", model },
    4,
  );
  await send({ type: "assistant_message", messageId: "a1", message: "Done" }, 9);
  await send({ type: "session_idle", turnOutcome: "completed" }, 9);

  expect(await turns()).toEqual([
    {
      runtimeKind: "codex",
      externalSessionId: "session-1",
      userMessageId: "u1",
      userMessageHash: agentSessionMessageFingerprint("Hi"),
      startedAt: new Date(2000).toISOString(),
      model,
    },
    {
      runtimeKind: "codex",
      externalSessionId: "session-1",
      userMessageId: "u2",
      userMessageHash: agentSessionMessageFingerprint("Also"),
      startedAt: new Date(4000).toISOString(),
      model,
      end: {
        completedAt: new Date(9000).toISOString(),
        outcome: "completed",
        durationMs: 7000,
        finalMessageId: "a1",
        interruption: undefined,
      },
    },
  ]);
});

test("saves the stop notice of a stopped run with no final reply", async () => {
  const { send, turns } = setup();
  await send({ type: "user_message", messageId: "u1", message: "Hi", parts: [], state: "read" }, 2);
  await send({ type: "assistant_message", messageId: "a1", message: "Wor" }, 3);
  const interruption = { messageId: "stop-1", message: "Session stopped at your request." };
  await send({ type: "session_idle", turnOutcome: "interrupted", interruption }, 5);

  expect(await turns()).toMatchObject([
    {
      userMessageId: "u1",
      end: {
        completedAt: new Date(3000).toISOString(),
        outcome: "interrupted",
        finalMessageId: undefined,
        interruption,
      },
    },
  ]);
});

test("saves no turn for a session with no open workspace", async () => {
  const { send, turns } = setup(null);
  await send({ type: "user_message", messageId: "u1", message: "Hi", parts: [], state: "read" }, 2);
  await send({ type: "session_idle", turnOutcome: "completed" }, 3);

  expect(await turns()).toEqual([]);
});
