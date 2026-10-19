import { messageSteeringBlock } from "./agent-message-steering";
import { omittedQueueSessions } from "./omitted-queue-sessions";
import { createSubmissionReservations } from "./submission-reservations";
import type {
  AcceptedAgentInput,
  AcceptedAgentUserMessage,
  AgentMessageQueueAction,
  AgentMessageQueueManageInput,
  AgentMessageQueueManageResult,
  AgentMessageQueueSnapshot,
  AgentMessageSubmitInput,
  AgentMessageSubmitResult,
  AgentSessionControlSendInput,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentMessageTarget,
  RuntimeKind,
} from "@openducktor/contracts";
import {
  type AgentDeliveryAvailability,
  agentSessionRefKey,
  agentSessionScopesEqual,
} from "@openducktor/core";
import { Effect } from "effect";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionSendOptions } from "../../ports/agent-session-live-adapter-port";
import {
  ACCEPTANCE_UNKNOWN_REASON,
  actionError,
  changeEntry,
  contentOf,
  endPauseIfEmpty,
  findAcceptedEntry,
  findEntry,
  type MessageQueue,
  markAcceptanceUnknown,
  type QueueEntry,
  type QueuePause,
  removeEntry,
  type SubmittedContent,
  snapshotOf,
  transitionEntry,
} from "./agent-message-queue-model";
import {
  blockedOnInputError,
  createSessionConditions,
  sessionChanges,
} from "./agent-message-session-conditions";
import { createQueueRegistry } from "./agent-message-queue-registry";
import {
  type SendOutcome,
  sendOutcome,
  reconcileAcceptedOutcome,
} from "./agent-message-send-outcome";
import type { AgentSessionSendContent } from "./agent-session-operation-policy";

export type AgentMessageDeliveryDependencies = {
  readonly submissionFingerprint: (input: AgentMessageSubmitInput) => string;
  readonly canonicalizeRepoPath: (repoPath: string) => Effect.Effect<string, HostError>;
  /** Checks the destination and prepares the owned message content. */
  readonly prepare: (
    content: AgentSessionSendContent,
  ) => Effect.Effect<AgentSessionSendContent, HostError>;
  readonly runOperation: <A, E>(
    target: AgentMessageTarget,
    effect: Effect.Effect<A, E>,
    submissionId?: string,
  ) => Effect.Effect<A, E | HostError>;
  readonly commitQueueResume: <A>(commit: () => A) => Effect.Effect<A, HostError>;
  readonly prepareQueueResume: (content: AgentSessionSendContent) => Effect.Effect<void, HostError>;
  /** Sends one message to its configured runtime session. */
  readonly send: (
    input: AgentSessionControlSendInput,
    options?: AgentSessionSendOptions,
  ) => Effect.Effect<AcceptedAgentInput, HostError>;
  /** Tells if the runtime of this kind can steer running work. */
  readonly steeringAvailability: (
    runtimeKind: RuntimeKind,
  ) => Effect.Effect<AgentDeliveryAvailability, HostError>;
  readonly publish: (envelope: AgentSessionLiveEnvelope) => void;
  /** Runs automatic delivery outside the caller. */
  readonly runInBackground: (effect: Effect.Effect<void>) => void;
  readonly now: () => string;
};

/** A steer can also find that steering cannot take the message while work runs. */
type SteerOutcome = SendOutcome | { readonly kind: "blocked"; readonly error: HostValidationError };

export type AgentMessageDeliveryService = {
  /** Options guard the first send and enqueue. Queued entries use the normal pause rules. */
  readonly submit: (
    input: AgentMessageSubmitInput,
    options?: AgentSessionSendOptions,
  ) => Effect.Effect<AgentMessageSubmitResult, HostError>;
  readonly manage: (
    input: AgentMessageQueueManageInput,
  ) => Effect.Effect<AgentMessageQueueManageResult, HostError>;
  /** Lists the queues of one repository for a connection snapshot. */
  readonly listQueues: (repoPath: string) => AgentMessageQueueSnapshot[];
  /** Reads live changes in their published order. A completed turn delivers the next message. */
  readonly observeChanges: (envelopes: ReadonlyArray<AgentSessionLiveEnvelope>) => void;
  /** A stop keeps the queue, but delivery waits until the user resumes it. */
  readonly pauseForStop: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
};

export const createAgentMessageDeliveryService = (
  dependencies: AgentMessageDeliveryDependencies,
): AgentMessageDeliveryService => {
  const registry = createQueueRegistry({
    publishSnapshot: (queue) => dependencies.publish({ type: "message_queue_updated", queue }),
    now: dependencies.now,
  });
  const { publish, forgetIfUnused, queueFor } = registry;
  const conditions = createSessionConditions();
  const reserveSubmission = createSubmissionReservations(dependencies.submissionFingerprint);

  /** Marks the send in flight synchronously, before another submission can start a turn. */
  const sendNewTurn = (
    queue: MessageQueue,
    content: AgentSessionSendContent,
    options?: AgentSessionSendOptions,
  ): Effect.Effect<SendOutcome> => {
    queue.sendingNewTurn = true;
    return sendOutcome(dependencies.send({ ...content, delivery: "new_turn" }, options)).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          queue.sendingNewTurn = false;
        }),
      ),
    );
  };

  const steeringBlock = (content: AgentSessionSendContent) =>
    messageSteeringBlock(content, dependencies.steeringAvailability);

  /** An idle session takes a new turn. A blocked or issued steer never retries as a new turn. */
  const steer = (
    content: AgentSessionSendContent,
    options?: AgentSessionSendOptions,
  ): Effect.Effect<SteerOutcome> =>
    Effect.gen(function* () {
      const blocked = yield* steeringBlock(content);
      const working = conditions.isWorking(agentSessionRefKey(content));
      if (working && blocked) return { kind: "blocked", error: blocked } as const;
      return yield* sendOutcome(
        dependencies.send({ ...content, delivery: working ? "steer" : "new_turn" }, options),
      );
    }).pipe(Effect.catch((error) => Effect.succeed({ kind: "refused", error } as const)));

  /** Finds the queue when the drain runs, so a queue that ended meanwhile gets no delivery. */
  const scheduleDrain = (sessionKey: string): void => {
    dependencies.runInBackground(Effect.suspend(() => drain(sessionKey)));
  };

  /**
   * Delivers after a change that can release the queue. While the agent works, a new turn would
   * fail, so the next completed turn delivers instead and the queue does not show a failed try.
   */
  const release = (queue: MessageQueue): void => {
    if (!conditions.isWorking(queue.key)) scheduleDrain(queue.key);
  };

  /** Releases a turn that completed during the send. A stale count only gets a busy refusal. */
  const settle = (queue: MessageQueue, completedTurnsBefore: number): void => {
    forgetIfUnused(queue);
    if (queue.completedTurns !== completedTurnsBefore) scheduleDrain(queue.key);
  };

  /** Pauses queued messages and in-flight sends. The first cause stays. */
  const pauseQueue = (queue: MessageQueue, pause: QueuePause): void => {
    if (queue.pause !== null) return;
    if (queue.entries.length === 0 && !queue.sendingNewTurn) return;
    queue.pause = pause;
    publish(queue);
  };

  /** Pauses failed delivery. Accepted entries leave; uncertain or refused entries keep their place. */
  const failEntry = (
    queue: MessageQueue,
    entry: QueueEntry,
    outcome: Exclude<SendOutcome, { kind: "accepted" }>,
  ): void => {
    // A live user message can show the entry before the send fails. It then left the queue.
    if (outcome.kind === "accepted_then_failed" || !queue.entries.includes(entry)) {
      // Not removeEntry: it ends the pause with the last entry, and this pause must stay.
      queue.entries = queue.entries.filter((candidate) => candidate !== entry);
      queue.pause ??= { cause: "accepted_then_failed", detail: outcome.error.message };
      return;
    }
    if (outcome.kind === "unknown") {
      markAcceptanceUnknown(entry, outcome.messageId);
      queue.pause ??= { cause: "acceptance_unknown" };
      return;
    }
    entry.state = "queued";
    entry.error = outcome.error.message;
    queue.pause ??= { cause: "delivery_failed", detail: outcome.error.message };
  };

  /**
   * Sends the first entry as a new turn when nothing blocks automatic delivery. The send keeps
   * the queue, so the queue stays the queue of its session until the send ends.
   */
  const drain = (sessionKey: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const queue = registry.find(sessionKey);
      if (!queue || queue.pause !== null || queue.sendingNewTurn) return;
      const head = queue.entries[0];
      if (!head || head.state !== "queued") return;
      if (conditions.isBlockedOnInput(sessionKey)) {
        // The answer to the pending input releases the entry.
        queue.waitsForInput = true;
        return;
      }
      head.state = "sending";
      delete head.error;
      const completedTurns = queue.completedTurns;
      const sent = sendNewTurn(queue, head.content);
      publish(queue);
      const outcome = reconcileAcceptedOutcome(yield* sent);
      if (outcome.kind === "accepted") removeEntry(queue, head);
      else if (outcome.kind === "busy") head.state = "queued";
      else failEntry(queue, head, outcome);
      publish(queue);
      settle(queue, completedTurns);
    });

  /** Retains an uncertain message at the front of its queue and blocks repeat delivery. */
  const queueUnknownMessage = (
    queue: MessageQueue,
    content: SubmittedContent,
    messageId?: string,
  ): AgentMessageSubmitResult => {
    markAcceptanceUnknown(registry.enqueue(queue, content, "first"), messageId);
    queue.pause ??= { cause: "acceptance_unknown" };
    return { kind: "queued", queue: publish(queue) };
  };

  /** Stop can run while preparation waits. Check and enqueue without yielding. */
  const enqueue = (
    queue: MessageQueue,
    content: SubmittedContent,
    position: "first" | "last",
    options?: AgentSessionSendOptions,
  ) =>
    Effect.suspend(() => {
      try {
        options?.assertCurrent?.();
      } catch (cause) {
        forgetIfUnused(queue);
        return Effect.fail(toHostOperationError(cause, "agent-message-delivery.enqueue"));
      }
      registry.enqueue(queue, content, position);
      return Effect.succeed<AgentMessageSubmitResult>({ kind: "queued", queue: publish(queue) });
    });

  /** The send keeps the queue, so the queue stays the queue of its session until the send ends. */
  const submitDefault = (content: SubmittedContent, options?: AgentSessionSendOptions) =>
    Effect.gen(function* () {
      const queue = queueFor(content);
      if (queue.entries.length > 0 || queue.sendingNewTurn) {
        return yield* enqueue(queue, content, "last", options);
      }
      const completedTurns = queue.completedTurns;
      const outcome = reconcileAcceptedOutcome(yield* sendNewTurn(queue, content, options));
      switch (outcome.kind) {
        case "accepted":
          // A message that the agent received ends a pause that has no messages left.
          if (endPauseIfEmpty(queue)) publish(queue);
          settle(queue, completedTurns);
          return { kind: "accepted", acceptedMessage: outcome.acceptedMessage } as const;
        case "busy": {
          // This message came before any message that queued while it was in flight.
          const queued = yield* enqueue(queue, content, "first", options);
          settle(queue, completedTurns);
          return queued;
        }
        case "unknown":
          return queueUnknownMessage(queue, content, outcome.messageId);
        case "accepted_then_failed":
          // The host state is unsure, so later messages wait for Resume.
          pauseQueue(queue, { cause: "accepted_then_failed", detail: outcome.error.message });
          break;
        case "refused":
          // Messages that queued behind this send can still start when the session is idle.
          if (queue.entries.length > 0) scheduleDrain(queue.key);
          break;
      }
      // A pause that came during the send only protected a refused message, which is now gone.
      if (endPauseIfEmpty(queue)) publish(queue);
      settle(queue, completedTurns);
      return yield* Effect.fail(outcome.error);
    });

  /** A failed steer pauses the session's current queue, which can change during the send. */
  const submitSteer = (content: SubmittedContent, options?: AgentSessionSendOptions) =>
    Effect.gen(function* () {
      const sent = yield* steer(content, options);
      const outcome = sent.kind === "blocked" ? sent : reconcileAcceptedOutcome(sent);
      switch (outcome.kind) {
        case "accepted":
          return { kind: "accepted", acceptedMessage: outcome.acceptedMessage } as const;
        case "unknown":
          return queueUnknownMessage(queueFor(content), content, outcome.messageId);
        case "accepted_then_failed":
          pause(content, { cause: "accepted_then_failed", detail: outcome.error.message });
          break;
        case "busy":
        case "refused":
          pause(content, { cause: "steer_failed", detail: outcome.error.message });
          break;
        case "blocked":
          // Nothing reached the runtime, so the queue does not pause.
          break;
      }
      return yield* Effect.fail(outcome.error);
    });

  const publishAndRelease = (queue: MessageQueue): AgentMessageQueueManageResult => {
    const snapshot = publish(queue);
    release(queue);
    return { queue: snapshot };
  };

  const steerEntry = (queue: MessageQueue, entry: QueueEntry) =>
    Effect.gen(function* () {
      // Pending input refuses the steer, so the entry keeps its place.
      if (conditions.isBlockedOnInput(queue.key)) return yield* blockedOnInputError();
      yield* transitionEntry(entry, ["queued"], () => {
        entry.state = "steering";
        delete entry.error;
      });
      publish(queue);
      const completedTurns = queue.completedTurns;
      const sent = yield* steer(entry.content);
      const outcome = sent.kind === "blocked" ? sent : reconcileAcceptedOutcome(sent);
      // A live user message can show the entry during the steer and end its queue. Nothing then
      // waits, and a newer queue of the session has no part in this steer.
      if (registry.find(queue.key) !== queue) {
        if (outcome.kind !== "accepted") return yield* Effect.fail(outcome.error);
        return { queue: snapshotOf(queue), acceptedMessage: outcome.acceptedMessage };
      }
      if (outcome.kind === "accepted") {
        removeEntry(queue, entry);
        const snapshot = publish(queue);
        settle(queue, completedTurns);
        return { queue: snapshot, acceptedMessage: outcome.acceptedMessage };
      }
      // Nothing reached the runtime, so the entry waits again.
      if (outcome.kind === "blocked") entry.state = "queued";
      else failEntry(queue, entry, outcome);
      publish(queue);
      settle(queue, completedTurns);
      return yield* Effect.fail(outcome.error);
    });

  const applyAction = (
    queue: MessageQueue | undefined,
    action: AgentMessageQueueAction,
  ): Effect.Effect<AgentMessageQueueManageResult, HostError> =>
    Effect.gen(function* () {
      if (action.kind === "resume") {
        if (!queue) return yield* actionError("This session has no queued messages.");
        // A pause stays while its cause remains. Running work does not block Resume.
        const blocker = queue.entries.some((entry) => entry.state === "acceptance_unknown")
          ? ACCEPTANCE_UNKNOWN_REASON
          : conditions.isBlockedOnInput(queue.key)
            ? conditions.resumeBlocker(queue.key)
            : null;
        if (blocker) return yield* actionError(blocker);
        const head = queue.entries[0];
        if (head) yield* dependencies.prepareQueueResume(head.content);
        return yield* dependencies.commitQueueResume(() => {
          queue.pause = null;
          return publishAndRelease(queue);
        });
      }
      const { queue: owner, entry } = yield* findEntry(queue, action.submissionId);
      if (action.kind === "steer") return yield* steerEntry(owner, entry);
      if (action.kind === "save_edit") {
        const prepared = yield* dependencies.prepare({
          ...entry.content,
          parts: action.parts,
        });
        action = { ...action, parts: prepared.parts };
      }
      const releasesQueue = yield* changeEntry(owner, entry, action, registry.nextEditId);
      return releasesQueue ? publishAndRelease(owner) : { queue: publish(owner) };
    });

  const pause = (ref: AgentSessionLiveRef, cause: QueuePause): void => {
    const queue = registry.findFor(ref);
    if (queue) pauseQueue(queue, cause);
  };

  /** The answer to blocking input releases a delivery that waited for it. */
  const releaseAfterInput = (sessionKey: string): void => {
    const queue = registry.find(sessionKey);
    if (!queue?.waitsForInput) return;
    queue.waitsForInput = false;
    release(queue);
  };

  /**
   * A live accepted message removes its pending entry at once, so the transcript and the queue
   * change together. It names its submission, or the native ID of an unknown delivery.
   */
  const resolveAccepted = (
    ref: AgentSessionLiveRef,
    acceptedMessage: AcceptedAgentUserMessage,
  ): void => {
    const queue = registry.findFor(ref);
    const entry = queue ? findAcceptedEntry(queue, acceptedMessage) : undefined;
    if (!queue || !entry) return;
    removeEntry(queue, entry);
    // The last unknown delivery resolved, but the remaining messages wait for Resume.
    const resolvedLastUnknown =
      entry.state === "acceptance_unknown" &&
      !queue.entries.some((candidate) => candidate.state === "acceptance_unknown");
    if (resolvedLastUnknown && queue.pause?.cause === "acceptance_unknown") {
      queue.pause = { cause: "acceptance_confirmed" };
    }
    publish(queue);
  };

  return {
    submit: (input, options) =>
      reserveSubmission(
        input,
        dependencies.runOperation(
          input,
          Effect.gen(function* () {
            const repoPath = yield* dependencies.canonicalizeRepoPath(input.repoPath);
            if (conditions.isBlockedOnInput(agentSessionRefKey({ ...input, repoPath })))
              return yield* blockedOnInputError();
            // The prepared message carries the stored destination, which keys its queue.
            const prepared = yield* dependencies.prepare({ ...contentOf(input), repoPath });
            delete prepared.systemPrompt;
            delete prepared.resolvedQuestionRequestIds;
            const content = { ...prepared, submissionId: input.submissionId };
            // Pending input refuses the message, so the composer keeps the draft.
            if (conditions.isBlockedOnInput(agentSessionRefKey(content))) {
              return yield* blockedOnInputError();
            }
            return yield* input.mode === "default"
              ? submitDefault(content, options)
              : submitSteer(content, options);
          }),
          input.submissionId,
        ),
      ),
    manage: (input) =>
      dependencies.runOperation(
        input,
        Effect.gen(function* () {
          const repoPath = yield* dependencies.canonicalizeRepoPath(input.repoPath);
          const queue = registry.findFor({ ...input, repoPath });
          // The queue key names only the runtime session, so the action must also name its owner.
          if (queue && !agentSessionScopesEqual(queue.target.sessionScope, input.sessionScope)) {
            return yield* actionError(
              "This queue belongs to another chat. Reload the chat and try again.",
            );
          }
          return yield* applyAction(queue, input.action);
        }),
      ),
    listQueues: registry.list,
    observeChanges: (envelopes) => {
      const completed = new Set<MessageQueue>();
      const changes = envelopes.flatMap((envelope) => [
        ...sessionChanges(envelope),
        ...omittedQueueSessions(envelope, registry.list),
      ]);
      for (const envelope of changes) {
        const signal = conditions.observe(envelope);
        if (signal?.kind === "input_answered") releaseAfterInput(signal.sessionKey);
        else if (signal?.kind === "pause") pause(signal.ref, signal.pause);
        else if (signal?.kind === "user_message")
          resolveAccepted(signal.ref, signal.acceptedMessage);
        else if (signal?.kind === "turn_completed") {
          const queue = registry.findFor(signal.ref);
          if (queue) completed.add(queue);
        }
      }
      // Pauses of the same batch apply first, so a failed turn never releases the next entry.
      for (const queue of completed) {
        queue.completedTurns += 1;
        scheduleDrain(queue.key);
      }
    },
    pauseForStop: (ref) =>
      dependencies
        .canonicalizeRepoPath(ref.repoPath)
        .pipe(Effect.map((repoPath) => pause({ ...ref, repoPath }, { cause: "stopped" }))),
  };
};
