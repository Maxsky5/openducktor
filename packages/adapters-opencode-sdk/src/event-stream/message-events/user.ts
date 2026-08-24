import type { AgentUserMessageDisplayPart } from "@openducktor/core";
import {
  normalizeUserMessageDisplayParts,
  type readMessageModelSelection,
} from "../../message-normalizers";
import type { QueuedUserMessageSend, SessionMessageMetadata } from "../../types";
import { admitUserMessage } from "../../user-message-admission";
import type { EventStreamRuntime } from "../shared";
import { emitBackgroundTaskResultSubagentParts } from "./background-task-result";
import { getKnownMessageParts } from "./helpers";
import { buildVisibleUserMessage } from "./user-display";
import { emitKnownUserMessage, emitUserMessage, persistUserMessageMetadata } from "./user-emitter";
import {
  resolveLiveUserMessageState,
  resolveUserMessageStateFromPendingAssistant,
  takeQueuedUserSendMatch,
} from "./user-state";

const resolveUserMessageDisplay = (input: {
  fallbackText: string;
  normalizedDisplayParts: AgentUserMessageDisplayPart[];
  metadata?: SessionMessageMetadata;
  runtime: EventStreamRuntime;
  model?: ReturnType<typeof readMessageModelSelection>;
}) => {
  const initialVisibleUserMessage = buildVisibleUserMessage({
    fallbackText: input.fallbackText,
    normalizedDisplayParts: input.normalizedDisplayParts,
    ...(input.metadata ? { metadata: input.metadata } : undefined),
  });
  const matchedQueuedSend = takeQueuedUserSendMatch(
    input.runtime,
    initialVisibleUserMessage.visible,
    initialVisibleUserMessage.displayParts,
    input.model,
  );

  if (!matchedQueuedSend) {
    return { ...initialVisibleUserMessage, matchedQueuedSend: null } satisfies {
      displayParts: AgentUserMessageDisplayPart[];
      matchedQueuedSend: QueuedUserMessageSend | null;
      visible: string;
    };
  }

  const finalVisibleUserMessage = buildVisibleUserMessage({
    fallbackText: input.fallbackText,
    normalizedDisplayParts: input.normalizedDisplayParts,
    ...(input.metadata ? { metadata: input.metadata } : undefined),
    matchedQueuedSend,
  });

  return { ...finalVisibleUserMessage, matchedQueuedSend } satisfies {
    displayParts: AgentUserMessageDisplayPart[];
    matchedQueuedSend: QueuedUserMessageSend | null;
    visible: string;
  };
};

export const publishUserMessageReadStateChanges = (runtime: EventStreamRuntime): void => {
  const { session } = runtime;

  for (const [messageId, emittedState] of session.emittedUserMessageStates.entries()) {
    if (session.messageRoleById.get(messageId) !== "user") {
      continue;
    }

    const nextState = resolveUserMessageStateFromPendingAssistant(session, messageId);
    if (nextState === emittedState) {
      continue;
    }

    const metadata = session.messageMetadataById.get(messageId);
    emitKnownUserMessage(runtime, {
      messageId,
      timestamp: metadata?.timestamp ?? runtime.now(),
      state: nextState,
      ...(metadata?.model ? { model: metadata.model } : undefined),
    });
  }
};

export const handleUserMessageUpdated = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    messageTimestamp: string;
    messageModel?: ReturnType<typeof readMessageModelSelection>;
  },
): boolean => {
  const { session } = runtime;
  admitUserMessage(session, input.messageId);
  const userParts = getKnownMessageParts(runtime, input.messageId);
  emitBackgroundTaskResultSubagentParts(runtime, {
    parts: userParts,
    timestamp: input.messageTimestamp,
  });
  const currentMetadata = session.messageMetadataById.get(input.messageId);
  const normalizedDisplayParts = normalizeUserMessageDisplayParts(userParts);
  const fallbackText = currentMetadata?.text ?? "";
  const { displayParts, matchedQueuedSend, visible } = resolveUserMessageDisplay({
    fallbackText,
    normalizedDisplayParts,
    runtime,
    ...(currentMetadata ? { metadata: currentMetadata } : undefined),
    ...(input.messageModel ? { model: input.messageModel } : undefined),
  });
  if (visible.trim().length === 0 && displayParts.length === 0) {
    return true;
  }

  const timestamp = currentMetadata?.timestamp ?? input.messageTimestamp;
  persistUserMessageMetadata({
    session,
    messageId: input.messageId,
    timestamp,
    ...(currentMetadata ? { metadata: currentMetadata } : undefined),
    ...(input.messageModel ? { model: input.messageModel } : undefined),
    visible,
    displayParts,
  });

  return emitUserMessage(runtime, {
    messageId: input.messageId,
    timestamp,
    message: visible,
    parts: displayParts,
    state: resolveLiveUserMessageState(runtime, {
      messageId: input.messageId,
      matchedQueuedSend,
    }),
    ...(input.messageModel ? { model: input.messageModel } : undefined),
  });
};

export const handleUserPartUpdated = (
  runtime: EventStreamRuntime,
  messageId: string,
  updatedPartTimestamp?: string,
): void => {
  const { session } = runtime;
  const metadata = session.messageMetadataById.get(messageId);
  const knownParts = getKnownMessageParts(runtime, messageId);
  const normalizedDisplayParts = normalizeUserMessageDisplayParts(knownParts);
  if (updatedPartTimestamp) {
    emitBackgroundTaskResultSubagentParts(runtime, {
      parts: knownParts,
      timestamp: updatedPartTimestamp,
    });
  }
  const fallbackText = metadata?.text ?? "";
  const { displayParts, matchedQueuedSend, visible } = resolveUserMessageDisplay({
    fallbackText,
    normalizedDisplayParts,
    runtime,
    ...(metadata ? { metadata } : undefined),
    ...(metadata?.model ? { model: metadata.model } : undefined),
  });
  if (visible.trim().length > 0 || displayParts.length > 0) {
    persistUserMessageMetadata({
      session,
      messageId,
      timestamp: runtime.now(),
      ...(metadata ? { metadata } : undefined),
      ...(metadata?.model ? { model: metadata.model } : undefined),
      visible,
      displayParts,
    });
  }
  emitKnownUserMessage(runtime, {
    messageId,
    timestamp: metadata?.timestamp ?? runtime.now(),
    visible,
    displayParts,
    state: resolveLiveUserMessageState(runtime, {
      messageId,
      matchedQueuedSend,
    }),
    ...(metadata?.model ? { model: metadata.model } : undefined),
  });
};
