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
  const initialInput: Parameters<typeof buildVisibleUserMessage>[0] = {
    fallbackText: input.fallbackText,
    normalizedDisplayParts: input.normalizedDisplayParts,
  };
  if (input.metadata) {
    initialInput.metadata = input.metadata;
  }
  const initialVisibleUserMessage = buildVisibleUserMessage(initialInput);
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

  const finalInput: Parameters<typeof buildVisibleUserMessage>[0] = {
    fallbackText: input.fallbackText,
    normalizedDisplayParts: input.normalizedDisplayParts,
    matchedQueuedSend,
  };
  if (input.metadata) {
    finalInput.metadata = input.metadata;
  }
  const finalVisibleUserMessage = buildVisibleUserMessage(finalInput);

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
    const messageInput: Parameters<typeof emitKnownUserMessage>[1] = {
      messageId,
      timestamp: metadata?.timestamp ?? runtime.now(),
      state: nextState,
    };
    if (metadata?.model) {
      messageInput.model = metadata.model;
    }
    emitKnownUserMessage(runtime, messageInput);
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
  const displayInput: Parameters<typeof resolveUserMessageDisplay>[0] = {
    fallbackText,
    normalizedDisplayParts,
    runtime,
  };
  if (currentMetadata) {
    displayInput.metadata = currentMetadata;
  }
  if (input.messageModel) {
    displayInput.model = input.messageModel;
  }
  const { displayParts, matchedQueuedSend, visible } = resolveUserMessageDisplay(displayInput);
  if (visible.trim().length === 0 && displayParts.length === 0) {
    return true;
  }

  const timestamp = currentMetadata?.timestamp ?? input.messageTimestamp;
  const metadataInput: Parameters<typeof persistUserMessageMetadata>[0] = {
    session,
    messageId: input.messageId,
    timestamp,
    visible,
    displayParts,
  };
  if (currentMetadata) {
    metadataInput.metadata = currentMetadata;
  }
  if (input.messageModel) {
    metadataInput.model = input.messageModel;
  }
  persistUserMessageMetadata(metadataInput);

  const messageInput: Parameters<typeof emitUserMessage>[1] = {
    messageId: input.messageId,
    timestamp,
    message: visible,
    parts: displayParts,
    state: resolveLiveUserMessageState(runtime, {
      messageId: input.messageId,
      matchedQueuedSend,
    }),
  };
  if (input.messageModel) {
    messageInput.model = input.messageModel;
  }
  return emitUserMessage(runtime, messageInput);
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
  const displayInput: Parameters<typeof resolveUserMessageDisplay>[0] = {
    fallbackText,
    normalizedDisplayParts,
    runtime,
  };
  if (metadata) {
    displayInput.metadata = metadata;
  }
  if (metadata?.model) {
    displayInput.model = metadata.model;
  }
  const { displayParts, matchedQueuedSend, visible } = resolveUserMessageDisplay(displayInput);
  if (visible.trim().length > 0 || displayParts.length > 0) {
    const metadataInput: Parameters<typeof persistUserMessageMetadata>[0] = {
      session,
      messageId,
      timestamp: runtime.now(),
      visible,
      displayParts,
    };
    if (metadata) {
      metadataInput.metadata = metadata;
    }
    if (metadata?.model) {
      metadataInput.model = metadata.model;
    }
    persistUserMessageMetadata(metadataInput);
  }
  const messageInput: Parameters<typeof emitKnownUserMessage>[1] = {
    messageId,
    timestamp: metadata?.timestamp ?? runtime.now(),
    visible,
    displayParts,
    state: resolveLiveUserMessageState(runtime, {
      messageId,
      matchedQueuedSend,
    }),
  };
  if (metadata?.model) {
    messageInput.model = metadata.model;
  }
  emitKnownUserMessage(runtime, messageInput);
};
