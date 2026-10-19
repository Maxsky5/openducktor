import { Effect, Exit, Fiber } from "effect";
import {
  claudeSessionLifecycleFailure,
  ClaudeSessionLifecycleError,
  settleClaudeSessionSteps,
} from "./claude-agent-sdk-session-lifecycle";
import type { AgentWorkStartGuard } from "@openducktor/core";
import { AbortError, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type AcceptedAgentUserMessage,
  type AgentModelSelection,
  AgentSessionMessageRefusedError,
  AgentSessionTurnActiveError,
  classifySystemSlashCommandInvocation,
  type SendAgentUserMessageInput,
} from "@openducktor/core";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import { beginClaudeManualCompaction } from "./claude-agent-sdk-compaction";
import {
  flushClaudeLiveContextUsageRefresh,
  scheduleClaudeLiveContextUsageRefresh,
  shouldRefreshClaudeContextUsageForMessage,
} from "./claude-agent-sdk-context-usage";
import { isClaudeContinuationAdmission } from "./claude-agent-sdk-continuation-admission";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { applyClaudeLifecycleEvent } from "./claude-agent-sdk-lifecycle";
import { readClaudeSdkMessageTimestamp } from "./claude-agent-sdk-message-timestamp";
import { isClaudeMessageUuid, toClaudeMessageFromParts } from "./claude-agent-sdk-messages";
import {
  assertClaudeSessionModelUpdateSupported,
  toClaudeFlagSettings,
} from "./claude-agent-sdk-session-model";
import { canStartUserTurn } from "./claude-agent-sdk-turn-policy";
import {
  applyClaudeUserMessageSignal,
  rejectPendingAdmissions,
  waitForUserMessageAdmission,
} from "./claude-agent-sdk-user-message-admission";
import { isClaudeSessionStopped } from "./claude-agent-sdk-session-store";
import { toClaudeDisplayParts, toClaudeUserMessageEvent } from "./claude-agent-sdk-session-shape";
import type {
  ClaudeAcceptedUserMessage,
  ClaudeAgentSdkEvent,
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  ClaudeSessionStore,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import { modelSelection, textFromContentBlocks } from "./claude-agent-sdk-utils";

const assertClaudeSessionAcceptingMessages = (session: ClaudeSession): void => {
  if (session.activity !== "stopped") {
    return;
  }
  throw new HostValidationError({
    field: "externalSessionId",
    message:
      "Claude Agent SDK session is no longer accepting messages after its SDK stream stopped.",
    details: {
      externalSessionId: session.externalSessionId,
      activity: session.activity,
    },
  });
};

const pushClaudeSdkUserMessage = (session: ClaudeSession, message: SDKUserMessage): void => {
  session.activeSdkUserTurnCount += 1;
  session.sdkState = "running";
  try {
    session.queue.push(message);
  } catch (error) {
    session.activeSdkUserTurnCount -= 1;
    throw error;
  }
};

export const applyClaudeSessionModel = async (
  session: ClaudeSession,
  model: AgentModelSelection | null | undefined,
  force = false,
  workStartGuard?: AgentWorkStartGuard,
  onWorkIssued?: () => void,
): Promise<void> => {
  assertClaudeSessionAcceptingMessages(session);
  const nextModel = model ?? undefined;
  assertClaudeSessionModelUpdateSupported(session, nextModel);

  const previousModel = session.model;
  const modelChanged = force || previousModel?.modelId !== nextModel?.modelId;
  const changed = {
    effort: force || previousModel?.variant !== nextModel?.variant,
    // An unknown native speed may come from user defaults, so set it explicitly.
    speed: force || previousModel === undefined || previousModel.speed !== nextModel?.speed,
  };
  const settingsChanged = changed.effort || changed.speed;
  try {
    if (modelChanged) {
      workStartGuard?.assertCurrent();
      const changing = session.query.setModel(nextModel?.modelId);
      onWorkIssued?.();
      await changing;
      assertClaudeSessionAcceptingMessages(session);
    }
    if (settingsChanged) {
      workStartGuard?.assertCurrent();
      const changing = session.query.applyFlagSettings(
        toClaudeFlagSettings(nextModel, session.externalSessionId, changed),
      );
      onWorkIssued?.();
      await changing;
      assertClaudeSessionAcceptingMessages(session);
    }
  } catch (cause) {
    if (isClaudeSessionStopped(session)) {
      throw cause;
    }
    const rollbackFailures: string[] = [];
    if (settingsChanged) {
      try {
        await session.query.applyFlagSettings(
          toClaudeFlagSettings(previousModel, session.externalSessionId, changed),
        );
      } catch (rollbackCause) {
        rollbackFailures.push(`settings: ${errorMessage(rollbackCause)}`);
      }
    }
    if (modelChanged) {
      try {
        await session.query.setModel(previousModel?.modelId);
      } catch (rollbackCause) {
        rollbackFailures.push(`model: ${errorMessage(rollbackCause)}`);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new HostOperationError({
        operation: "claude.session.model.update",
        message: `Claude model update failed and rollback was incomplete: ${rollbackFailures.join(
          "; ",
        )}`,
        cause,
        details: {
          externalSessionId: session.externalSessionId,
          rollbackFailures,
        },
      });
    }
    throw cause;
  }
  session.model = nextModel;
};

export const consumeClaudeSession = (input: {
  emit: ClaudeAgentSdkEventEmitter;
  now: () => string;
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"];
  onContinuationAdmission?: () => void;
  session: ClaudeSession;
  sessionStore: Pick<ClaudeSessionStore, "close" | "get" | "finish" | "ownConsumption">;
}): Promise<void> => {
  const { emit, now, onBackgroundFailure, onContinuationAdmission, session, sessionStore } = input;
  const isLiveSession = (): boolean => sessionStore.get(session.externalSessionId) === session;
  let continuationAdmitted = onContinuationAdmission === undefined;
  const operation = "claudeRuntime.consumeSession";
  const failure = (cause: unknown) => new ClaudeSessionLifecycleError(operation, [cause]);
  const emitEvent = (event: ClaudeAgentSdkEvent): void => emit(session, event);
  const stream = Effect.tryPromise({
    try: async () => {
      for await (const message of session.query) {
        const timestamp = readClaudeSdkMessageTimestamp(message, now);
        if (onContinuationAdmission && isClaudeContinuationAdmission(message)) {
          continuationAdmitted = true;
          onContinuationAdmission();
        }
        if (applyClaudeUserMessageSignal({ emit: emitEvent, message, session })) continue;
        handleClaudeSdkMessage({ session, message, timestamp, emit: emitEvent, modelSelection });
        if (shouldRefreshClaudeContextUsageForMessage(message)) {
          scheduleClaudeLiveContextUsageRefresh({ emit, onBackgroundFailure, session, timestamp });
        }
      }
    },
    catch: failure,
  }).pipe(
    Effect.catch((cause) =>
      session.abortController.signal.aborted && cause.cause instanceof AbortError
        ? Effect.void
        : Effect.fail(cause),
    ),
  );
  const program = Effect.acquireUseRelease(
    Effect.void,
    () =>
      Effect.gen(function* () {
        const streamed = yield* Effect.exit(stream);
        session.activity = "stopped";
        yield* settleClaudeSessionSteps([
          streamed,
          Effect.try({
            try: () => {
              if (Exit.isFailure(streamed) && isLiveSession() && continuationAdmitted) {
                emitEvent({
                  type: "session_error",
                  externalSessionId: session.externalSessionId,
                  timestamp: now(),
                  message: claudeSessionLifecycleFailure(streamed.cause, operation).message,
                });
              }
            },
            catch: failure,
          }),
          Effect.tryPromise({
            try: () => flushClaudeLiveContextUsageRefresh(session),
            catch: failure,
          }),
          Effect.try({
            try: () => {
              // An unadmitted replacement cannot terminalize the attached session.
              if (isLiveSession() && continuationAdmitted) {
                sessionStore.finish(
                  session,
                  Exit.isFailure(streamed)
                    ? "Claude Agent SDK session stream stopped after an error."
                    : "Claude Agent SDK session stream ended.",
                  emit,
                  now(),
                );
              }
            },
            catch: failure,
          }),
        ]);
      }),
    () =>
      settleClaudeSessionSteps([
        Effect.try({ try: () => sessionStore.close(session), catch: failure }),
        Effect.tryPromise({ try: () => session.query.return().then(() => {}), catch: failure }),
        Effect.try({
          try: () =>
            rejectPendingAdmissions(
              session,
              new Error("The Claude Agent SDK stream ended before it acknowledged the message."),
            ),
          catch: failure,
        }),
      ]),
  ).pipe(
    Effect.catchCause((cause) => Effect.fail(claudeSessionLifecycleFailure(cause, operation))),
    Effect.tapError(onBackgroundFailure),
    Effect.withSpan(operation),
  );
  // The SDK boundary starts the consumer; the store owns it through shutdown.
  const consumer = Effect.runFork(program);
  sessionStore.ownConsumption(session, consumer, () => continuationAdmitted);
  const completion = Effect.runPromise(Fiber.join(consumer));
  // The owned fiber reports failures even when startup no longer awaits this Promise.
  void completion.catch(() => {});
  return completion;
};

/**
 * Starts a turn with the message when no turn runs or waits. Otherwise it steers the running
 * turn, or throws `AgentSessionTurnActiveError` for a `new_turn` delivery. It resolves only after
 * the CLI admits the message.
 */
export const sendClaudeUserMessage = async (input: {
  emit: ClaudeAgentSdkEventEmitter;
  messageInput: SendAgentUserMessageInput;
  now: () => string;
  randomId: () => string;
  session: ClaudeSession;
  onSent?: (() => void) | undefined;
  assertCurrent?: (() => void) | undefined;
}): Promise<AcceptedAgentUserMessage> => {
  const { emit, messageInput, now, randomId, session } = input;
  const isManualCompaction =
    classifySystemSlashCommandInvocation(messageInput.parts).kind === "manual_session_compaction";
  assertClaudeSessionAcceptingMessages(session);
  const timestamp = now();
  const messageId = randomId();
  if (!isClaudeMessageUuid(messageId)) {
    throw new HostValidationError({
      field: "randomId",
      message: "Claude user-message IDs must be UUIDs.",
      details: { messageId },
    });
  }
  const sdkMessage = await toClaudeMessageFromParts(messageInput.parts);
  const message = textFromContentBlocks(sdkMessage.message.content);
  assertClaudeSessionAcceptingMessages(session);
  const displayParts = toClaudeDisplayParts(messageInput.parts);
  sdkMessage.uuid = messageId;
  sdkMessage.session_id = session.externalSessionId;
  sdkMessage.timestamp = timestamp;
  const acceptedMessage: ClaudeAcceptedUserMessage = {
    messageId,
    parts: displayParts,
    text: message,
    timestamp,
  };
  if (messageInput.submissionId) acceptedMessage.submissionId = messageInput.submissionId;
  if (!canStartUserTurn(session)) {
    if (messageInput.delivery === "new_turn") {
      throw new AgentSessionTurnActiveError(session.externalSessionId);
    }
    return steerClaudeUserMessage({
      acceptedMessage,
      sdkMessage,
      session,
      onSent: input.onSent,
      assertCurrent: input.assertCurrent,
    });
  }
  if (messageInput.delivery === "steer")
    throw new AgentSessionMessageRefusedError(
      new Error(
        "The running turn ended before steering. Send a new turn with current host context.",
      ),
    );
  const previousActivity = session.activity;
  const previousTurnSystemPrompt = session.turnSystemPrompt;
  if (messageInput.systemPrompt !== undefined) session.turnSystemPrompt = messageInput.systemPrompt;
  const previousSdkState = session.sdkState;
  const previousPendingUserTurnCount = session.pendingUserTurnCount;
  if (isManualCompaction) {
    acceptedMessage.isManualCompaction = true;
  }
  if (session.model) acceptedMessage.model = session.model;
  session.acceptedUserMessages.push(acceptedMessage);
  session.pendingUserTurnCount = previousPendingUserTurnCount + 1;
  session.activity = "running";
  const admission = waitForUserMessageAdmission(session, messageId);
  try {
    input.assertCurrent?.();
    messageInput.workStartGuard?.assertCurrent();
    pushClaudeSdkUserMessage(session, sdkMessage);
    if (isManualCompaction) {
      beginClaudeManualCompaction({
        session,
        timestamp,
        messageId,
        emit: (event) => emit(session, event),
      });
    }
  } catch (cause) {
    admission.dispose();
    session.acceptedUserMessages.pop();
    if (isClaudeSessionStopped(session)) {
      throw cause;
    }
    session.pendingUserTurnCount = previousPendingUserTurnCount;
    session.turnSystemPrompt = previousTurnSystemPrompt;
    session.activity = previousActivity;
    if (previousSdkState === undefined) {
      delete session.sdkState;
    } else {
      session.sdkState = previousSdkState;
    }
    throw cause;
  }
  input.onSent?.();
  emit(session, {
    type: "session_status",
    externalSessionId: session.externalSessionId,
    timestamp,
    status: { type: "busy", message: null },
  });
  try {
    await admission.admitted;
  } catch (cause) {
    if (cause instanceof AgentSessionMessageRefusedError) {
      // The CLI cancelled the message, so the turn that this send started never runs.
      session.acceptedUserMessages.splice(session.acceptedUserMessages.indexOf(acceptedMessage), 1);
      applyClaudeLifecycleEvent({
        emit: (event) => emit(session, event),
        session,
        timestamp: now(),
        event: { kind: "user_turn_cancelled" },
      });
    }
    throw cause;
  }
  return toClaudeUserMessageEvent(session, acceptedMessage, "read");
};

/**
 * Sends a message to the running turn with SDK priority `now`. The message does not start
 * a turn, so the turn counters stay unchanged. It stays unread until the CLI echoes it.
 * The `human` origin lets the message join the running turn between tool calls. A message
 * that arrives while the model streams a reply stops that reply instead; see
 * `isClaudeResultStoppedBySteer`.
 */
const steerClaudeUserMessage = async (input: {
  acceptedMessage: ClaudeAcceptedUserMessage;
  sdkMessage: SDKUserMessage;
  session: ClaudeSession;
  onSent?: (() => void) | undefined;
  assertCurrent?: (() => void) | undefined;
}): Promise<AcceptedAgentUserMessage> => {
  const { acceptedMessage, sdkMessage, session } = input;
  sdkMessage.priority = "now";
  sdkMessage.origin = { kind: "human" };
  const admission = waitForUserMessageAdmission(session, acceptedMessage.messageId);
  try {
    input.assertCurrent?.();
    session.queue.push(sdkMessage);
    input.onSent?.();
  } catch (error) {
    admission.dispose();
    throw error;
  }
  session.unreadSteeredUserMessages.set(acceptedMessage.messageId, acceptedMessage);
  try {
    await admission.admitted;
  } catch (cause) {
    session.unreadSteeredUserMessages.delete(acceptedMessage.messageId);
    throw cause;
  }
  return toClaudeUserMessageEvent(
    session,
    acceptedMessage,
    session.unreadSteeredUserMessages.has(acceptedMessage.messageId) ? "queued" : "read",
  );
};
