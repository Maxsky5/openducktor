import type { Part } from "@opencode-ai/sdk/v2/client";
import {
  normalizeUserMessageDisplayParts,
  type readMessageModelSelection,
  readTextFromMessageInfo,
} from "../../message-normalizers";
import type { EventStreamRuntime } from "../shared";
import { getKnownMessageParts } from "./helpers";
import { buildVisibleUserMessage } from "./user-display";
import { emitKnownUserMessage, emitUserMessage, persistUserMessageMetadata } from "./user-emitter";
import {
  readExplicitUserMessageState,
  resolveLiveUserMessageState,
  resolveUserMessageStateFromPendingAssistant,
  takeQueuedUserSendMatch,
} from "./user-state";

export const reconcileUserMessageQueuedStates = (runtime: EventStreamRuntime): void => {
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
  const currentMetadata = session?.messageMetadataById.get(input.messageId);
  const normalizedDisplayParts = normalizeUserMessageDisplayParts(userParts);
  const fallbackText = currentMetadata?.text ?? readTextFromMessageInfo(input.infoRecord);
  const initialVisibleUserMessage = buildVisibleUserMessage({
    fallbackText,
    normalizedDisplayParts,
    ...(currentMetadata ? { metadata: currentMetadata } : {}),
  });
  const matchedQueuedSend = takeQueuedUserSendMatch(
    runtime,
    initialVisibleUserMessage.visible,
    initialVisibleUserMessage.displayParts,
    input.messageModel,
  );
  const { displayParts, visible } = buildVisibleUserMessage({
    fallbackText,
    normalizedDisplayParts,
    ...(currentMetadata ? { metadata: currentMetadata } : {}),
    ...(matchedQueuedSend ? { matchedQueuedSend } : {}),
  });
  if (visible.trim().length === 0 && displayParts.length === 0) {
    return true;
  }

  persistUserMessageMetadata({
    session,
    messageId: input.messageId,
    timestamp: input.messageTimestamp,
    ...(currentMetadata ? { metadata: currentMetadata } : {}),
    ...(input.messageModel ? { model: input.messageModel } : {}),
    visible,
    displayParts,
  });

  const explicitState = readExplicitUserMessageState(input.infoRecord, input.properties);
  return emitUserMessage(runtime, {
    messageId: input.messageId,
    timestamp: input.messageTimestamp,
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

export const handleUserPartUpdated = (runtime: EventStreamRuntime, messageId: string): void => {
  const session = runtime.getSession(runtime.externalSessionId);
  const metadata = session?.messageMetadataById.get(messageId);
  const normalizedDisplayParts = normalizeUserMessageDisplayParts(
    getKnownMessageParts(runtime, messageId),
  );
  const fallbackText = metadata?.text ?? "";
  const initialVisibleUserMessage = buildVisibleUserMessage({
    fallbackText,
    normalizedDisplayParts,
    ...(metadata ? { metadata } : {}),
  });
  const matchedQueuedSend = takeQueuedUserSendMatch(
    runtime,
    initialVisibleUserMessage.visible,
    initialVisibleUserMessage.displayParts,
    metadata?.model,
  );
  const { displayParts, visible } = buildVisibleUserMessage({
    fallbackText,
    normalizedDisplayParts,
    ...(metadata ? { metadata } : {}),
    ...(matchedQueuedSend ? { matchedQueuedSend } : {}),
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
