import { expect, test } from "bun:test";
import type {
  AcceptedAgentUserMessage,
  AgentMessageSubmitInput,
  AgentSessionControlSendInput,
} from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { resolvePreparedSessionAttachments } from "../../application/attachments/resolve-session-message-parts";
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
    runOperation: (_target, effect) => effect,
    commitQueueResume: (commit) => Effect.sync(commit),
    prepareQueueResume: () => Effect.void,
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

test("owns attachment preparation after disconnection and returns compact receipts without repeat delivery", async () => {
  const preparing = Deferred.makeUnsafe<void>();
  const finish = Deferred.makeUnsafe<void>();
  const delivered = Deferred.makeUnsafe<void>();
  let sends = 0;
  const delivery = createNodeMessageDelivery({
    eventBus: { publish: () => {}, subscribe: () => () => {} },
    onBackgroundFailure: () => Effect.void,
    runOperation: (_target, work) => work,
    commitQueueResume: (commit) => Effect.sync(commit),
    prepareQueueResume: () => Effect.void,
    canonicalizeRepoPath: Effect.succeed,
    prepare: (content) =>
      resolvePreparedSessionAttachments(Effect.succeed(content), {
        resolve: () =>
          Deferred.succeed(preparing, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as({ path: "/staged/verified.pdf" }),
          ),
      }),
    send: (content) =>
      Effect.gen(function* () {
        expect(content.parts[0]).toMatchObject({ attachment: { path: "/staged/verified.pdf" } });
        sends += 1;
        yield* Deferred.succeed(delivered, undefined);
        return accepted(content);
      }),
    runtimeRegistry: { status: () => Effect.die(new Error("Unexpected runtime status")) },
    runtimeDefinitions: { listRuntimeDefinitions: () => [] },
  });
  const input = {
    ...submission("first"),
    parts: [
      {
        kind: "attachment" as const,
        attachment: {
          id: "attachment",
          path: "brief.pdf",
          name: "brief.pdf",
          kind: "pdf" as const,
          mime: "application/pdf",
        },
      },
    ],
  };
  try {
    const caller = Effect.runFork(delivery.submit(input));
    await Effect.runPromise(Deferred.await(preparing));
    await Effect.runPromise(Fiber.interrupt(caller));
    expect(sends).toBe(0);
    Effect.runSync(Deferred.succeed(finish, undefined));
    await Effect.runPromise(Deferred.await(delivered));
    await Effect.runPromise(delivery.submit(structuredClone(input)));
    const repeated = await Effect.runPromise(delivery.submit(structuredClone(input)));
    expect(repeated).toEqual({
      kind: "acknowledged",
      submissionId: input.submissionId,
      outcome: "accepted",
      acknowledgement: {
        kind: "message",
        ref,
        submissionId: input.submissionId,
        messageId: "message-first",
      },
    });
    expect(JSON.stringify(repeated)).not.toContain("brief.pdf");
    await expect(
      Effect.runPromise(
        delivery.submit({ ...input, parts: [{ kind: "text", text: "different message" }] }),
      ),
    ).rejects.toThrow("different target or message");
    expect(sends).toBe(1);
  } finally {
    await Effect.runPromise(delivery.shutdown());
  }
});
