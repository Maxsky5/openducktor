import {
  renameSession,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type AcceptedAgentUserMessage,
  type AgentModelSelection,
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
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { toClaudeMessageFromParts } from "./claude-agent-sdk-messages";
import {
  assertClaudeSessionModelUpdateSupported,
  assertSupportedClaudeLiveEffort,
} from "./claude-agent-sdk-session-model";
import { toClaudeDisplayParts } from "./claude-agent-sdk-session-shape";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  ClaudeSessionStore,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import { modelSelection, textFromContentBlocks } from "./claude-agent-sdk-utils";

const hasActiveSdkUserTurn = (session: ClaudeSession): boolean =>
  session.activeSdkUserTurnCount > 0;

const canFlushQueuedClaudeUserMessage = (session: ClaudeSession): boolean =>
  session.activity !== "stopped" &&
  session.queuedSdkMessages.length > 0 &&
  !hasActiveSdkUserTurn(session) &&
  session.sdkState !== "running";

const canPushSdkUserMessageNow = (session: ClaudeSession): boolean =>
  !hasActiveSdkUserTurn(session) &&
  session.queuedSdkMessages.length === 0 &&
  session.sdkState !== "running" &&
  session.modelAfterQueuedTurns === undefined;

const isClaudeSessionStopped = (session: ClaudeSession): boolean => session.activity === "stopped";

const canRestoreClaudeSessionModelAfterQueuedTurns = (session: ClaudeSession): boolean =>
  session.modelAfterQueuedTurns !== undefined &&
  !hasActiveSdkUserTurn(session) &&
  session.queuedSdkMessages.length === 0 &&
  session.sdkState === "idle";

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

const readClaudeSdkMessageTimestamp = (message: SDKMessage, now: () => string): string => {
  const timestamp = (message as { timestamp?: unknown }).timestamp;
  if (typeof timestamp !== "string") {
    return now();
  }
  return Number.isNaN(Date.parse(timestamp)) ? now() : timestamp;
};

export const applyClaudeSessionModel = async (
  session: ClaudeSession,
  model: AgentModelSelection | null | undefined,
): Promise<void> => {
  assertClaudeSessionAcceptingMessages(session);
  const nextModel = model ?? undefined;
  assertClaudeSessionModelUpdateSupported(session, nextModel);

  const previousModel = session.model;
  const modelChanged = previousModel?.modelId !== nextModel?.modelId;
  const effortChanged = previousModel?.variant !== nextModel?.variant;
  try {
    if (modelChanged) {
      await session.query.setModel(nextModel?.modelId);
      assertClaudeSessionAcceptingMessages(session);
    }
    if (effortChanged) {
      await session.query.applyFlagSettings({
        effortLevel: nextModel
          ? assertSupportedClaudeLiveEffort(nextModel, session.externalSessionId)
          : null,
      });
      assertClaudeSessionAcceptingMessages(session);
    }
  } catch (cause) {
    if (isClaudeSessionStopped(session)) {
      throw cause;
    }
    const rollbackFailures: string[] = [];
    if (effortChanged) {
      try {
        await session.query.applyFlagSettings({
          effortLevel: previousModel
            ? assertSupportedClaudeLiveEffort(previousModel, session.externalSessionId)
            : null,
        });
      } catch (rollbackCause) {
        rollbackFailures.push(`effort: ${errorMessage(rollbackCause)}`);
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

const restoreClaudeSessionModelAfterQueuedTurns = async (session: ClaudeSession): Promise<void> => {
  const model = session.modelAfterQueuedTurns;
  if (model === undefined) {
    return;
  }
  await applyClaudeSessionModel(session, model);
  delete session.modelAfterQueuedTurns;
};

const rollbackClaudeSessionModel = async (input: {
  cause: unknown;
  operation: string;
  previousModel: AgentModelSelection | undefined;
  session: ClaudeSession;
}): Promise<void> => {
  const { cause, operation, previousModel, session } = input;
  try {
    await applyClaudeSessionModel(session, previousModel);
  } catch (rollbackCause) {
    throw new HostOperationError({
      operation,
      message: `Claude message delivery failed and model rollback was incomplete: ${errorMessage(rollbackCause)}`,
      cause,
      details: {
        externalSessionId: session.externalSessionId,
        rollbackFailure: errorMessage(rollbackCause),
      },
    });
  }
};

export const consumeClaudeSession = async (input: {
  emit: ClaudeAgentSdkEventEmitter;
  now: () => string;
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"];
  session: ClaudeSession;
  sessionStore: Pick<ClaudeSessionStore, "close" | "get">;
}): Promise<void> => {
  const { emit, now, onBackgroundFailure, session, sessionStore } = input;
  const isLiveSession = (): boolean => sessionStore.get(session.externalSessionId) === session;
  const closeLiveSession = (): void => {
    if (isLiveSession()) {
      sessionStore.close(session);
    }
  };
  const failSession = async (error: unknown): Promise<void> => {
    if (!isLiveSession()) {
      return;
    }
    const timestamp = now();
    emit(session, {
      type: "session_error",
      externalSessionId: session.externalSessionId,
      timestamp,
      message: errorMessage(error),
    });
    closeLiveSession();
    await flushClaudeLiveContextUsageRefresh(session);
    emit(session, {
      type: "session_finished",
      externalSessionId: session.externalSessionId,
      timestamp,
      message: "Claude Agent SDK session stream stopped after an error.",
    });
  };
  try {
    for await (const message of session.query) {
      const timestamp = readClaudeSdkMessageTimestamp(message, now);
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
        await restoreClaudeSessionModelAfterQueuedTurns(session);
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
    if (isLiveSession()) {
      const timestamp = now();
      emit(session, {
        type: "session_finished",
        externalSessionId: session.externalSessionId,
        timestamp,
        message: "Claude Agent SDK session stream ended.",
      });
      closeLiveSession();
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
  const sdkMessage = await toClaudeMessageFromParts(messageInput.parts);
  const message = textFromContentBlocks(sdkMessage.message.content);
  assertClaudeSessionAcceptingMessages(session);
  const displayParts = toClaudeDisplayParts(messageInput.parts);
  sdkMessage.uuid = messageId as NonNullable<SDKUserMessage["uuid"]>;
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
  session.acceptedUserMessages.push({
    messageId,
    ...(isManualCompaction ? { isManualCompaction: true } : {}),
    ...(messageInput.model ? { model: messageInput.model } : {}),
    parts: displayParts,
    text: message,
    timestamp,
  });
  session.pendingUserTurnCount = previousPendingUserTurnCount + 1;
  session.activity = "running";
  try {
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
    session.acceptedUserMessages.pop();
    if (isClaudeSessionStopped(session)) {
      throw cause;
    }
    session.pendingUserTurnCount = previousPendingUserTurnCount;
    session.activity = previousActivity;
    if (previousSdkState === undefined) {
      delete session.sdkState;
    } else {
      session.sdkState = previousSdkState;
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
  return {
    type: "user_message",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageId,
    message,
    parts: displayParts,
    state: canSendImmediately ? "read" : "queued",
    ...(messageInput.model ? { model: messageInput.model } : {}),
  };
};

export const flushQueuedClaudeUserMessage = (input: {
  emit: ClaudeAgentSdkEventEmitter;
  now: () => string;
  session: ClaudeSession;
}): Promise<void> => {
  const { emit, now, session } = input;
  if (session.activity === "stopped" || session.queuedSdkMessages.length === 0) {
    return Promise.resolve();
  }
  if (hasActiveSdkUserTurn(session)) {
    return Promise.resolve();
  }
  if (session.sdkState === "running") {
    return Promise.resolve();
  }
  const nextMessage = session.queuedSdkMessages[0];
  if (!nextMessage) {
    return Promise.resolve();
  }
  const timestamp = now();
  const previousActivity = session.activity;
  const previousSdkState = session.sdkState;
  session.activity = "running";
  const acceptedMessage = session.acceptedUserMessages.find(
    (message) => message.messageId === nextMessage.uuid,
  );
  const previousModel = session.model;
  const previousModelAfterQueuedTurns = session.modelAfterQueuedTurns;
  let modelApplied = false;
  let removedFromQueue = false;
  return Promise.resolve()
    .then(async () => {
      if (acceptedMessage?.model) {
        if (session.modelAfterQueuedTurns === undefined) {
          session.modelAfterQueuedTurns = previousModel ?? null;
        }
        await applyClaudeSessionModel(session, acceptedMessage.model);
        modelApplied = true;
      }
      assertClaudeSessionAcceptingMessages(session);
      if (session.queuedSdkMessages[0] !== nextMessage) {
        throw new HostOperationError({
          operation: "claudeRuntime.flushQueuedUserMessage",
          message: `Claude session '${session.externalSessionId}' user-message queue changed while preparing its next message.`,
          details: { externalSessionId: session.externalSessionId },
        });
      }
      session.queuedSdkMessages.shift();
      removedFromQueue = true;
      pushClaudeSdkUserMessage(session, nextMessage);
      if (acceptedMessage?.isManualCompaction) {
        beginClaudeManualCompaction({
          session,
          timestamp,
          messageId: acceptedMessage.messageId,
          emit: (event) => emit(session, event),
        });
      }
    })
    .then(() => {
      assertClaudeSessionAcceptingMessages(session);
      if (acceptedMessage && !acceptedMessage.isManualCompaction) {
        emit(session, {
          type: "user_message",
          externalSessionId: session.externalSessionId,
          timestamp,
          messageId: acceptedMessage.messageId,
          message: acceptedMessage.text,
          parts: acceptedMessage.parts,
          state: "read",
          ...(acceptedMessage.model ? { model: acceptedMessage.model } : {}),
        });
      }
      emit(session, {
        type: "session_status",
        externalSessionId: session.externalSessionId,
        timestamp,
        status: { type: "busy", message: null },
      });
    })
    .catch(async (cause) => {
      if (session.activity === "stopped") {
        throw cause;
      }
      if (removedFromQueue) {
        session.queuedSdkMessages.unshift(nextMessage);
      }
      session.activity = previousActivity;
      if (previousSdkState === undefined) {
        delete session.sdkState;
      } else {
        session.sdkState = previousSdkState;
      }
      if (modelApplied) {
        await rollbackClaudeSessionModel({
          cause,
          operation: "claudeRuntime.flushQueuedUserMessage",
          previousModel,
          session,
        });
      } else {
        session.model = previousModel;
      }
      if (previousModelAfterQueuedTurns === undefined) {
        delete session.modelAfterQueuedTurns;
      } else {
        session.modelAfterQueuedTurns = previousModelAfterQueuedTurns;
      }
      throw cause;
    });
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
