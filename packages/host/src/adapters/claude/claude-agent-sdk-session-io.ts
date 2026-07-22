import {
  renameSession,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AcceptedAgentUserMessage,
  AgentModelSelection,
  SendAgentUserMessageInput,
} from "@openducktor/core";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  flushClaudeLiveContextUsageRefresh,
  scheduleClaudeLiveContextUsageRefresh,
  shouldRefreshClaudeContextUsageForMessage,
} from "./claude-agent-sdk-context-usage";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { encodeClaudePromptText, toClaudeMessageFromParts } from "./claude-agent-sdk-messages";
import { toClaudeDisplayParts } from "./claude-agent-sdk-session-shape";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  ClaudeSessionStore,
} from "./claude-agent-sdk-types";
import { modelSelection } from "./claude-agent-sdk-utils";

const LIVE_CLAUDE_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh"]);

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
  session.sdkState !== "running";

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

const assertSupportedClaudeLiveEffort = (
  model: AgentModelSelection,
  externalSessionId: string,
): "low" | "medium" | "high" | "xhigh" | null => {
  if (!model.variant) {
    return null;
  }
  if (LIVE_CLAUDE_EFFORT_LEVELS.has(model.variant)) {
    return model.variant as "low" | "medium" | "high" | "xhigh";
  }
  throw new HostValidationError({
    field: "model.variant",
    message: `Claude Agent SDK live effort updates do not support '${model.variant}'.`,
    details: { externalSessionId, model },
  });
};

export const applyClaudeSessionModel = async (
  session: ClaudeSession,
  model: AgentModelSelection | null | undefined,
): Promise<void> => {
  const nextModel = model ?? undefined;
  assertClaudeSessionModelUpdateSupported(session, nextModel);

  const previousModel = session.model;
  const modelChanged = previousModel?.modelId !== nextModel?.modelId;
  const effortChanged = previousModel?.variant !== nextModel?.variant;
  try {
    if (modelChanged) {
      await session.query.setModel(nextModel?.modelId);
    }
    if (effortChanged) {
      await session.query.applyFlagSettings({
        effortLevel: nextModel
          ? assertSupportedClaudeLiveEffort(nextModel, session.externalSessionId)
          : null,
      });
    }
  } catch (cause) {
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

const assertClaudeSessionModelUpdateSupported = (
  session: ClaudeSession,
  model: AgentModelSelection | null | undefined,
): void => {
  const nextModel = model ?? undefined;
  const previousProfileId = session.model?.profileId ?? null;
  const nextProfileId = nextModel?.profileId ?? null;
  if (previousProfileId !== nextProfileId) {
    throw new HostValidationError({
      field: "model.profileId",
      message: "Claude Agent SDK live model updates do not support changing agents.",
      details: {
        externalSessionId: session.externalSessionId,
        model: nextModel,
        previousProfileId,
      },
    });
  }

  if (session.model?.variant !== nextModel?.variant && nextModel) {
    assertSupportedClaudeLiveEffort(nextModel, session.externalSessionId);
  }
};

export const consumeClaudeSession = async (input: {
  emit: ClaudeAgentSdkEventEmitter;
  now: () => string;
  session: ClaudeSession;
  sessionStore: Pick<ClaudeSessionStore, "close" | "get">;
}): Promise<void> => {
  const { emit, now, session, sessionStore } = input;
  const isLiveSession = (): boolean => sessionStore.get(session.externalSessionId) === session;
  const closeLiveSession = (): void => {
    if (isLiveSession()) {
      sessionStore.close(session);
    }
  };
  const failSession = (error: unknown): void => {
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
        scheduleClaudeLiveContextUsageRefresh({ emit, session, timestamp });
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
    failSession(error);
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
  if (session.activity === "stopped") {
    throw new HostValidationError({
      field: "externalSessionId",
      message:
        "Claude Agent SDK session is no longer accepting messages after its SDK stream stopped.",
      details: {
        externalSessionId: session.externalSessionId,
        activity: session.activity,
      },
    });
  }
  const timestamp = now();
  const messageId = randomId();
  const message = encodeClaudePromptText(
    messageInput.parts.filter((part) => part.kind !== "attachment"),
  );
  const sdkMessage = await toClaudeMessageFromParts(messageInput.parts);
  const displayParts = toClaudeDisplayParts(messageInput.parts);
  sdkMessage.uuid = messageId as NonNullable<SDKUserMessage["uuid"]>;
  sdkMessage.session_id = session.externalSessionId;
  sdkMessage.timestamp = timestamp;
  const canSendImmediately = canPushSdkUserMessageNow(session);
  const previousModel = session.model;
  if (messageInput.model !== undefined) {
    if (canSendImmediately) {
      await applyClaudeSessionModel(session, messageInput.model);
    } else {
      assertClaudeSessionModelUpdateSupported(session, messageInput.model);
    }
  }
  const previousActivity = session.activity;
  const previousSdkState = session.sdkState;
  const previousPendingUserTurnCount = session.pendingUserTurnCount;
  session.acceptedUserMessages.push({
    messageId,
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
    } else {
      session.queuedSdkMessages.push(sdkMessage);
    }
  } catch (error) {
    session.acceptedUserMessages.pop();
    session.pendingUserTurnCount = previousPendingUserTurnCount;
    session.activity = previousActivity;
    if (previousSdkState === undefined) {
      delete session.sdkState;
    } else {
      session.sdkState = previousSdkState;
    }
    session.model = previousModel;
    throw error;
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
  let removedFromQueue = false;
  return Promise.resolve()
    .then(async () => {
      if (acceptedMessage?.model) {
        await applyClaudeSessionModel(session, acceptedMessage.model);
      }
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
    })
    .then(() => {
      if (acceptedMessage) {
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
    .catch((error) => {
      if (removedFromQueue) {
        session.queuedSdkMessages.unshift(nextMessage);
      }
      session.model = previousModel;
      session.activity = previousActivity;
      if (previousSdkState === undefined) {
        delete session.sdkState;
      } else {
        session.sdkState = previousSdkState;
      }
      throw error;
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
