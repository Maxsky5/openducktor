import type { Part } from "@opencode-ai/sdk/v2/client";
import type { AgentUserMessageDisplayPart } from "@openducktor/core";
import {
  normalizeUserMessageDisplayParts,
  type readMessageModelSelection,
  readTextFromMessageInfo,
} from "../../message-normalizers";
import type { QueuedUserMessageSend, SessionMessageMetadata } from "../../types";
import type { EventStreamRuntime } from "../shared";
import { emitBackgroundTaskResultSubagentParts } from "./background-task-result";
import { getKnownMessageParts } from "./helpers";
import { buildVisibleUserMessage } from "./user-display";
import { emitKnownUserMessage, emitUserMessage, persistUserMessageMetadata } from "./user-emitter";
import {
  readExplicitUserMessageState,
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
}): {
  displayParts: AgentUserMessageDisplayPart[];
  matchedQueuedSend: QueuedUserMessageSend | null;
  visible: string;
} => {
  const initialVisibleUserMessage = buildVisibleUserMessage({
    fallbackText: input.fallbackText,
    normalizedDisplayParts: input.normalizedDisplayParts,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  const matchedQueuedSend = takeQueuedUserSendMatch(
    input.runtime,
    initialVisibleUserMessage.visible,
    initialVisibleUserMessage.displayParts,
    input.model,
  );

  if (!matchedQueuedSend) {
    return { ...initialVisibleUserMessage, matchedQueuedSend: null };
  }

  const finalVisibleUserMessage = buildVisibleUserMessage({
    fallbackText: input.fallbackText,
    normalizedDisplayParts: input.normalizedDisplayParts,
    ...(input.metadata ? { metadata: input.metadata } : {}),
    matchedQueuedSend,
  });

  return { ...finalVisibleUserMessage, matchedQueuedSend };
};

export const publishUserMessageReadStateChanges = (runtime: EventStreamRuntime): void => {
  const session = runtime.getSession(runtime.externalSessionId);
  if (!session) {
    return;
  }

  for (const [messageId, emittedState] of session.emittedUserMessageStates.entries()) {
    if (runtime.messageRoleById.get(messageId) !== "user") {
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
      ...(metadata?.model ? { model: metadata.model } : {}),
    });
  }
};

export const handleUserMessageUpdated = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    messageTimestamp: string;
    infoRecord: unknown;
    properties: unknown;
    normalizedParts: Part[];
    messageModel?: ReturnType<typeof readMessageModelSelection>;
  },
): boolean => {
  const session = runtime.getSession(runtime.externalSessionId);
  const userParts =
    input.normalizedParts.length > 0
      ? input.normalizedParts
      : getKnownMessageParts(runtime, input.messageId);
  emitBackgroundTaskResultSubagentParts(runtime, {
    parts: userParts,
    timestamp: input.messageTimestamp,
  });
  const currentMetadata = session?.messageMetadataById.get(input.messageId);
  const normalizedDisplayParts = normalizeUserMessageDisplayParts(userParts);
  const fallbackText = currentMetadata?.text ?? readTextFromMessageInfo(input.infoRecord);
  const { displayParts, matchedQueuedSend, visible } = resolveUserMessageDisplay({
    fallbackText,
    normalizedDisplayParts,
    runtime,
    ...(currentMetadata ? { metadata: currentMetadata } : {}),
    ...(input.messageModel ? { model: input.messageModel } : {}),
  });
  if (visible.trim().length === 0 && displayParts.length === 0) {
    return true;
  }

  const timestamp = currentMetadata?.timestamp ?? input.messageTimestamp;
  persistUserMessageMetadata({
    session,
    messageId: input.messageId,
    timestamp,
    ...(currentMetadata ? { metadata: currentMetadata } : {}),
    ...(input.messageModel ? { model: input.messageModel } : {}),
    visible,
    displayParts,
  });

  const explicitState = readExplicitUserMessageState(input.infoRecord, input.properties);
  return emitUserMessage(runtime, {
    messageId: input.messageId,
    timestamp,
    message: visible,
    parts: displayParts,
    state: resolveLiveUserMessageState(runtime, {
      messageId: input.messageId,
      matchedQueuedSend,
      ...(explicitState ? { explicitState } : {}),
    }),
    ...(input.messageModel ? { model: input.messageModel } : {}),
  });
};

export const handleUserPartUpdated = (
  runtime: EventStreamRuntime,
  messageId: string,
  updatedPartTimestamp?: string,
): void => {
  const session = runtime.getSession(runtime.externalSessionId);
  const metadata = session?.messageMetadataById.get(messageId);
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
    ...(metadata ? { metadata } : {}),
    ...(metadata?.model ? { model: metadata.model } : {}),
  });
  if (visible.trim().length > 0 || displayParts.length > 0) {
    persistUserMessageMetadata({
      session,
      messageId,
      timestamp: runtime.now(),
      ...(metadata ? { metadata } : {}),
      ...(metadata?.model ? { model: metadata.model } : {}),
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
    ...(metadata?.model ? { model: metadata.model } : {}),
  });
};
