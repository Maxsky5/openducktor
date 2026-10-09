import {
  assertClaudeSessionAcceptingMessages,
  pushClaudeSdkUserMessage,
  applyClaudeSessionModel,
  restoreClaudeSessionModelAfterQueuedTurns,
  rollbackClaudeSessionModel,
  flushQueuedClaudeUserMessage,
} from "./claude-agent-sdk-session-dispatch";
import {
  observeClaudeSessionModel,
  prepareClaudeTurnSpeed,
} from "./claude-session-speed-preparation";
import {
  commitClaudeSessionChoiceReport,
  observeClaudeSpeed,
} from "./claude-session-speed-observation";
import { renameSession } from "@anthropic-ai/claude-agent-sdk";
import {
  type AcceptedAgentUserMessage,
  classifySystemSlashCommandInvocation,
  type SendAgentUserMessageInput,
} from "@openducktor/core";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import { beginClaudeManualCompaction } from "./claude-agent-sdk-compaction";
import {
  flushClaudeLiveContextUsageRefresh,
  scheduleClaudeLiveContextUsageRefresh,
  shouldRefreshClaudeContextUsageForMessage,
} from "./claude-agent-sdk-context-usage";
import { isClaudeContinuationAdmission } from "./claude-agent-sdk-continuation-admission";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { readClaudeSdkMessageTimestamp } from "./claude-agent-sdk-message-timestamp";
import { isClaudeMessageUuid, toClaudeMessageFromParts } from "./claude-agent-sdk-messages";
import { assertClaudeSessionModelUpdateSupported } from "./claude-agent-sdk-session-model";
import {
  canFlushQueuedClaudeUserMessage,
  canPushSdkUserMessageNow,
  canRestoreClaudeSessionModelAfterQueuedTurns,
} from "./claude-agent-sdk-session-queue-policy";
import { isClaudeSessionStopped } from "./claude-agent-sdk-session-store";
import { toClaudeDisplayParts } from "./claude-agent-sdk-session-shape";
import type {
  ClaudeAcceptedUserMessage,
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  ClaudeSessionStore,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import { modelSelection, textFromContentBlocks } from "./claude-agent-sdk-utils";

export const consumeClaudeSession = async (input: {
  emit: ClaudeAgentSdkEventEmitter;
  now: () => string;
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"];
  onContinuationAdmission?: () => void;
  session: ClaudeSession;
  sessionStore: Pick<ClaudeSessionStore, "close" | "get">;
}): Promise<void> => {
  const { emit, now, onBackgroundFailure, onContinuationAdmission, session, sessionStore } = input;
  const isLiveSession = (): boolean => sessionStore.get(session.externalSessionId) === session;
  const closeLiveSession = (): void => {
    if (isLiveSession()) {
      sessionStore.close(session);
    }
  };
  // A replacement that never admitted the continuation must not remove the attached session.
  let continuationAdmitted = onContinuationAdmission === undefined;
  const finishLiveSession = (message: string): void => {
    if (isLiveSession() && continuationAdmitted) {
      emit(session, {
        type: "session_finished",
        externalSessionId: session.externalSessionId,
        timestamp: now(),
        message,
      });
    }
    closeLiveSession();
  };
  const failSession = async (cause: unknown): Promise<void> => {
    // The interrupted-turn path reads this flag before it restores a failed continuation.
    session.activity = "stopped";
    if (!isLiveSession()) {
      return;
    }
    const timestamp = now();
    if (continuationAdmitted) {
      emit(session, {
        type: "session_error",
        externalSessionId: session.externalSessionId,
        timestamp,
        message: errorMessage(cause),
      });
    }
    await flushClaudeLiveContextUsageRefresh(session);
    if (!isLiveSession()) {
      return;
    }
    finishLiveSession("Claude Agent SDK session stream stopped after an error.");
  };
  try {
    for await (const message of session.query) {
      const timestamp = readClaudeSdkMessageTimestamp(message, now);
      const firstModelReport =
        message.type === "system" &&
        message.subtype === "init" &&
        session.nativeModel === undefined;
      if (message.type === "system" && message.subtype === "init") {
        if (session.nativeModel === undefined)
          session.nativeModel = { modelId: message.model, effort: message.effort };
        else if (
          session.nativeModel.modelId !== message.model ||
          (message.effort !== undefined && session.nativeModel.effort !== message.effort)
        )
          await observeClaudeSessionModel(
            session,
            { modelId: message.model, effort: message.effort },
            emit,
            timestamp,
            onBackgroundFailure,
          );
      }
      if (
        message.type === "system" &&
        message.subtype === "model_refusal_fallback" &&
        message.scope !== "local"
      )
        await observeClaudeSessionModel(
          session,
          { modelId: message.fallback_model },
          emit,
          timestamp,
          onBackgroundFailure,
        );
      if (onContinuationAdmission && isClaudeContinuationAdmission(message)) {
        continuationAdmitted = true;
        onContinuationAdmission();
      }
      if ("fast_mode_state" in message || "fast_mode_disabled_reason" in message) {
        if (message.type === "system" && message.subtype === "init")
          await commitClaudeSessionChoiceReport(session, message, onBackgroundFailure);
        const observation = observeClaudeSpeed(
          session,
          message,
          message.type === "system" && message.subtype === "init",
        );
        emit(session, {
          type: "session_speed_changed",
          externalSessionId: session.externalSessionId,
          timestamp,
          observation,
        });
      }
      // Saved model metadata does not describe a cold attachment's native settings.
      if (
        firstModelReport &&
        session.preserveNativeSettings &&
        session.speedInitialized &&
        message.type === "system" &&
        message.subtype === "init"
      )
        await observeClaudeSessionModel(
          session,
          { modelId: message.model, effort: message.effort },
          emit,
          timestamp,
          onBackgroundFailure,
        );
      handleClaudeSdkMessage({
        session,
        message,
        timestamp,
        emit: (event) => emit(session, event),
        modelSelection,
      });
      const shouldRefreshContextUsage = shouldRefreshClaudeContextUsageForMessage(message);
      if (shouldRefreshContextUsage) {
        scheduleClaudeLiveContextUsageRefresh({ emit, onBackgroundFailure, session, timestamp });
      }
      if (canRestoreClaudeSessionModelAfterQueuedTurns(session)) {
        await restoreClaudeSessionModelAfterQueuedTurns(session, emit, timestamp);
      }
      const shouldFlushQueuedMessage =
        (message.type === "system" &&
          message.subtype === "session_state_changed" &&
          message.state === "idle") ||
        canFlushQueuedClaudeUserMessage(session);
      if (shouldFlushQueuedMessage) {
        await flushQueuedClaudeUserMessage({
          emit,
          now,
          session,
        });
      }
    }
    await flushClaudeLiveContextUsageRefresh(session);
    // A stream that ends after a replacement took the store key must still stop.
    session.activity = "stopped";
    if (isLiveSession()) {
      finishLiveSession("Claude Agent SDK session stream ended.");
    }
  } catch (error) {
    await failSession(error);
  }
};

export const sendClaudeUserMessage = async (input: {
  emit: ClaudeAgentSdkEventEmitter;
  messageInput: SendAgentUserMessageInput;
  now: () => string;
  randomId: () => string;
  session: ClaudeSession;
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
  const canSendImmediately = canPushSdkUserMessageNow(session);
  const previousModel = session.model;
  let modelApplied = false;
  if (messageInput.model !== undefined) {
    if (canSendImmediately) {
      await applyClaudeSessionModel(session, messageInput.model);
      modelApplied = true;
      assertClaudeSessionAcceptingMessages(session);
    } else {
      assertClaudeSessionModelUpdateSupported(session, messageInput.model);
    }
  }
  const previousActivity = session.activity;
  const previousSdkState = session.sdkState;
  const previousPendingUserTurnCount = session.pendingUserTurnCount;
  const acceptedMessage: ClaudeAcceptedUserMessage = {
    messageId,
    parts: displayParts,
    text: message,
    timestamp,
  };
  if (isManualCompaction) {
    acceptedMessage.isManualCompaction = true;
  }
  if (messageInput.model) {
    acceptedMessage.model = messageInput.model;
  }
  try {
    if (canSendImmediately) {
      await prepareClaudeTurnSpeed(session, emit, timestamp);
      assertClaudeSessionAcceptingMessages(session);
    }
    session.acceptedUserMessages.push(acceptedMessage);
    session.pendingUserTurnCount = previousPendingUserTurnCount + 1;
    session.activity = "running";
    if (canSendImmediately) {
      pushClaudeSdkUserMessage(session, sdkMessage);
      if (isManualCompaction) {
        beginClaudeManualCompaction({
          session,
          timestamp,
          messageId,
          emit: (event) => emit(session, event),
        });
      }
    } else {
      session.queuedSdkMessages.push(sdkMessage);
    }
  } catch (cause) {
    const accepted = session.acceptedUserMessages.at(-1) === acceptedMessage;
    if (accepted) session.acceptedUserMessages.pop();
    if (isClaudeSessionStopped(session)) {
      throw cause;
    }
    if (accepted) {
      session.pendingUserTurnCount = previousPendingUserTurnCount;
      session.activity = previousActivity;
      if (previousSdkState === undefined) {
        delete session.sdkState;
      } else {
        session.sdkState = previousSdkState;
      }
    }
    if (modelApplied) {
      await rollbackClaudeSessionModel({
        cause,
        operation: "claudeRuntime.sendUserMessage",
        previousModel,
        session,
      });
    } else {
      session.model = previousModel;
    }
    throw cause;
  }
  emit(session, {
    type: "session_status",
    externalSessionId: session.externalSessionId,
    timestamp,
    status: { type: "busy", message: null },
  });
  const acceptedEvent: AcceptedAgentUserMessage = {
    type: "user_message",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageId,
    message,
    parts: displayParts,
    state: canSendImmediately ? "read" : "queued",
  };
  if (messageInput.model) {
    acceptedEvent.model = messageInput.model;
  }
  return acceptedEvent;
};

export const renameClaudeSessionIfNeeded = async (input: {
  session: ClaudeSession;
  title: string | undefined;
}): Promise<void> => {
  const title = input.title?.trim();
  if (!title) {
    return;
  }
  await renameSession(input.session.externalSessionId, title, {
    dir: input.session.input.workingDirectory,
  });
};
