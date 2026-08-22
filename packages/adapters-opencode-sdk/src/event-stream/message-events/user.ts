import type { JsonValue } from "@openducktor/contracts";
import type { Part } from "@opencode-ai/sdk/v2/client";
import type { AgentUserMessageDisplayPart } from "@openducktor/core";
import {
  normalizeUserMessageDisplayParts,
  type readMessageModelSelection,
  readTextFromMessageInfo,
} from "../../message-normalizers";
import type { QueuedUserMessageSend, SessionMessageMetadata } from "../../types";
import { admitUserMessage } from "../../user-message-admission";
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
}) => {
  const initialVisibleUserMessage = buildVisibleUserMessage({
    fallbackText: input.fallbackText,
    normalizedDisplayParts: input.normalizedDisplayParts,
    ...(() => {
      if (input.metadata) {
        return { metadata: input.metadata };
      }
      return {};
    })(),
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
    ...(() => {
      if (input.metadata) {
        return { metadata: input.metadata };
      }
      return {};
    })(),
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
      ...(() => {
        if (metadata?.model) {
          return { model: metadata.model };
        }
        return {};
      })(),
    });
  }
};

export const handleUserMessageUpdated = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    messageTimestamp: string;
    infoRecord: JsonValue | undefined;
    properties: JsonValue | undefined;
    normalizedParts: Part[];
    messageModel?: ReturnType<typeof readMessageModelSelection>;
  },
): boolean => {
  const { session } = runtime;
  admitUserMessage(session, input.messageId);
  const userParts =
    input.normalizedParts.length > 0
      ? input.normalizedParts
      : getKnownMessageParts(runtime, input.messageId);
  emitBackgroundTaskResultSubagentParts(runtime, {
    parts: userParts,
    timestamp: input.messageTimestamp,
  });
  const currentMetadata = session.messageMetadataById.get(input.messageId);
  const normalizedDisplayParts = normalizeUserMessageDisplayParts(userParts);
  const fallbackText = currentMetadata?.text ?? readTextFromMessageInfo(input.infoRecord);
  const { displayParts, matchedQueuedSend, visible } = resolveUserMessageDisplay({
    fallbackText,
    normalizedDisplayParts,
    runtime,
    ...(() => {
      if (currentMetadata) {
        return { metadata: currentMetadata };
      }
      return {};
    })(),
    ...(() => {
      if (input.messageModel) {
        return { model: input.messageModel };
      }
      return {};
    })(),
  });
  if (visible.trim().length === 0 && displayParts.length === 0) {
    return true;
  }

  const timestamp = currentMetadata?.timestamp ?? input.messageTimestamp;
  persistUserMessageMetadata({
    session,
    messageId: input.messageId,
    timestamp,
    ...(() => {
      if (currentMetadata) {
        return { metadata: currentMetadata };
      }
      return {};
    })(),
    ...(() => {
      if (input.messageModel) {
        return { model: input.messageModel };
      }
      return {};
    })(),
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
      ...(() => {
        if (explicitState) {
          return { explicitState };
        }
        return {};
      })(),
    }),
    ...(() => {
      if (input.messageModel) {
        return { model: input.messageModel };
      }
      return {};
    })(),
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
    ...(() => {
      if (metadata) {
        return { metadata };
      }
      return {};
    })(),
    ...(() => {
      if (metadata?.model) {
        return { model: metadata.model };
      }
      return {};
    })(),
  });
  if (visible.trim().length > 0 || displayParts.length > 0) {
    persistUserMessageMetadata({
      session,
      messageId,
      timestamp: runtime.now(),
      ...(() => {
        if (metadata) {
          return { metadata };
        }
        return {};
      })(),
      ...(() => {
        if (metadata?.model) {
          return { model: metadata.model };
        }
        return {};
      })(),
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
    ...(() => {
      if (metadata?.model) {
        return { model: metadata.model };
      }
      return {};
    })(),
  });
};
