import { expect, test } from "bun:test";
import type {
  AcceptedAgentUserMessage,
  AgentMessageSubmitInput,
  AgentSessionControlSendInput,
} from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import { createNodeMessageDelivery } from "./node-message-delivery";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "session-1",
};

const submission = (text: string): AgentMessageSubmitInput => ({
  ...ref,
  sessionScope: { kind: "repository" },
  submissionId: `submission-${text}`,
  mode: "default",
  parts: [{ kind: "text", text }],
});

const accepted = (input: AgentSessionControlSendInput): AcceptedAgentUserMessage => ({
  type: "user_message",
  externalSessionId: input.externalSessionId,
  timestamp: "2026-10-08T10:00:00.000Z",
  messageId: "message-first",
  message: "first",
  parts: [],
  state: "read",
});

test("interrupts a background delivery at shutdown", async () => {
  const firstSend = Deferred.makeUnsafe<AcceptedAgentUserMessage>();
  const backgroundSendStarted = Deferred.makeUnsafe<void>();
  let backgroundSendInterrupted = false;
  let sends = 0;
  const messageDelivery = createNodeMessageDelivery({
    eventBus: { publish: () => {}, subscribe: () => () => {} },
    onBackgroundFailure: () => Effect.void,
    canonicalizeRepoPath: Effect.succeed,
    prepare: Effect.succeed,
    send: () => {
      sends += 1;
      if (sends === 1) return Deferred.await(firstSend);
      return Deferred.succeed(backgroundSendStarted, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            backgroundSendInterrupted = true;
          }),
        ),
      );
    },
    runtimeRegistry: { status: () => Effect.die(new Error("Unexpected runtime status read")) },
    runtimeDefinitions: { listRuntimeDefinitions: () => [] },
  });
  // The second message waits behind the first send, so the next completed turn delivers it.
  const first = Effect.runPromise(messageDelivery.submit(submission("first")));
  await Effect.runPromise(messageDelivery.submit(submission("second")));
  Effect.runSync(
    Deferred.succeed(firstSend, accepted({ ...submission("first"), delivery: "new_turn" })),
  );
  await first;
  messageDelivery.observeChanges([
    {
      type: "transcript_event",
      event: {
        type: "session_idle",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-10-08T10:00:01.000Z",
        sessionRef: ref,
        turnOutcome: "completed",
      },
    },
  ]);
  await Effect.runPromise(Deferred.await(backgroundSendStarted));

  await Effect.runPromise(messageDelivery.shutdown());

  expect(backgroundSendInterrupted).toBe(true);
});
