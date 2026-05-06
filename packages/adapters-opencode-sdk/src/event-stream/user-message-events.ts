import type { AgentUserMessageDisplayPart, AgentUserMessageState } from "@openducktor/core";
import { readStringProp } from "../guards";
import {
  ensureVisibleUserTextDisplayParts,
  mergePreservedAttachmentDisplayParts,
  normalizeUserMessageDisplayParts,
  type readMessageModelSelection,
  readTextFromMessageInfo,
  readVisibleUserTextFromDisplayParts,
} from "../message-normalizers";
import type { QueuedUserMessageSend, SessionMessageMetadata } from "../types";
import {
  buildQueuedDisplayAttachmentIdentitySignature,
  buildQueuedDisplaySignature,
} from "../user-message-signatures";
import { getKnownMessageParts } from "./message-event-helpers";
import type { EventStreamRuntime } from "./shared";

type UserDisplayPart = AgentUserMessageDisplayPart;
type AttachmentDisplayPart = Extract<UserDisplayPart, { kind: "attachment" }>;

const readPreservedAttachmentParts = (input: {
  metadata?: SessionMessageMetadata;
  matchedQueuedSend?: QueuedUserMessageSend | null;
}): AttachmentDisplayPart[] => {
  return [
    ...(input.metadata?.displayParts?.filter(
      (part): part is AttachmentDisplayPart => part.kind === "attachment",
    ) ?? []),
    ...(input.matchedQueuedSend?.attachmentParts ?? []),
  ];
};

const buildVisibleUserMessage = (input: {
  fallbackText: string;
  normalizedDisplayParts: UserDisplayPart[];
  metadata?: SessionMessageMetadata;
  matchedQueuedSend?: QueuedUserMessageSend | null;
}): {
  displayParts: UserDisplayPart[];
  visible: string;
} => {
  const mergedDisplayParts = mergePreservedAttachmentDisplayParts(
    input.normalizedDisplayParts,
    readPreservedAttachmentParts({
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.matchedQueuedSend ? { matchedQueuedSend: input.matchedQueuedSend } : {}),
    }),
  );
  const displayParts = ensureVisibleUserTextDisplayParts(
    mergedDisplayParts.length > 0 ? mergedDisplayParts : (input.metadata?.displayParts ?? []),
    input.fallbackText,
  );
  const textFromParts = readVisibleUserTextFromDisplayParts(displayParts);
  return {
    displayParts,
    visible: textFromParts.length > 0 ? textFromParts : input.fallbackText,
  };
};

const persistUserMessageMetadata = (input: {
  session: ReturnType<EventStreamRuntime["getSession"]>;
  messageId: string;
  timestamp: string;
  metadata?: SessionMessageMetadata;
  model?: ReturnType<typeof readMessageModelSelection>;
  visible: string;
  displayParts: UserDisplayPart[];
}): void => {
  input.session?.messageMetadataById.set(input.messageId, {
    timestamp: input.metadata?.timestamp ?? input.timestamp,
    ...(input.model
      ? { model: input.model }
      : input.metadata?.model
        ? { model: input.metadata.model }
        : {}),
    ...(input.metadata?.parentId ? { parentId: input.metadata.parentId } : {}),
    text: input.visible,
    ...(input.displayParts.length > 0 ? { displayParts: input.displayParts } : {}),
  });
};

const emitKnownUserMessage = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    timestamp: string;
    state: AgentUserMessageState;
    model?: ReturnType<typeof readMessageModelSelection>;
    visible?: string;
    displayParts?: AgentUserMessageDisplayPart[];
  },
): boolean => {
  const session = runtime.getSession(runtime.externalSessionId);
  const metadata = session?.messageMetadataById.get(input.messageId);
  const knownDisplayParts = normalizeUserMessageDisplayParts(
    getKnownMessageParts(runtime, input.messageId),
  );
  const fallbackText = metadata?.text ?? "";
  const displayParts =
    input.displayParts ??
    ensureVisibleUserTextDisplayParts(
      knownDisplayParts.length > 0 ? knownDisplayParts : (metadata?.displayParts ?? []),
      fallbackText,
    );
  const textFromParts = input.visible ?? readVisibleUserTextFromDisplayParts(displayParts);
  const visible = textFromParts.length > 0 ? textFromParts : fallbackText;
  if (visible.trim().length === 0 && displayParts.length === 0) {
    return false;
  }

  return emitUserMessage(runtime, {
    messageId: input.messageId,
    timestamp: input.timestamp,
    message: visible,
    parts: displayParts,
    state: input.state,
    ...(input.model ? { model: input.model } : {}),
  });
};

const buildUserMessageSignature = (input: {
  timestamp: string;
  message: string;
  parts: AgentUserMessageDisplayPart[];
  state: AgentUserMessageState;
  model?: ReturnType<typeof readMessageModelSelection>;
}): string => {
  const model = input.model;
  return JSON.stringify({
    timestamp: input.timestamp,
    message: input.message,
    parts: input.parts,
    state: input.state,
    providerId: model?.providerId ?? null,
    modelId: model?.modelId ?? null,
    variant: model?.variant ?? null,
    profileId: model?.profileId ?? null,
  });
};

const emitUserMessage = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    timestamp: string;
    message: string;
    parts: AgentUserMessageDisplayPart[];
    state: AgentUserMessageState;
    model?: ReturnType<typeof readMessageModelSelection>;
  },
): boolean => {
  const session = runtime.getSession(runtime.externalSessionId);
  const signature = buildUserMessageSignature(input);
  if (session?.emittedUserMessageSignatures.get(input.messageId) === signature) {
    return true;
  }

  runtime.emit(runtime.externalSessionId, {
    type: "user_message",
    externalSessionId: runtime.externalSessionId,
    timestamp: input.timestamp,
    messageId: input.messageId,
    message: input.message,
    parts: input.parts,
    state: input.state,
    ...(input.model ? { model: input.model } : {}),
  });
  session?.emittedUserMessageSignatures.set(input.messageId, signature);
  session?.emittedUserMessageStates.set(input.messageId, input.state);
  return true;
};

const readExplicitUserMessageState = (
  ...sources: Array<unknown>
): AgentUserMessageState | undefined => {
  for (const source of sources) {
    const rawState = readStringProp(source, ["state"]);
    if (rawState === "queued" || rawState === "read") {
      return rawState;
    }
  }
  return undefined;
};

const takeQueuedUserSendMatch = (
  runtime: EventStreamRuntime,
  visible: string,
  parts: AgentUserMessageDisplayPart[],
  model: ReturnType<typeof readMessageModelSelection> | undefined,
): QueuedUserMessageSend | null => {
  const session = runtime.getSession(runtime.externalSessionId);
  if (!session || session.pendingQueuedUserMessages.length === 0) {
    return null;
  }

  const signature = buildQueuedDisplaySignature({
    visible,
    parts,
    ...(model ? { model } : {}),
  });
  const attachmentIdentitySignature = buildQueuedDisplayAttachmentIdentitySignature({
    visible,
    parts,
    ...(model ? { model } : {}),
  });
  const matchIndex = session.pendingQueuedUserMessages.findIndex(
    (entry) =>
      entry.signature === signature ||
      entry.attachmentIdentitySignature === attachmentIdentitySignature,
  );
  if (matchIndex < 0) {
    return null;
  }

  return session.pendingQueuedUserMessages.splice(matchIndex, 1)[0] ?? null;
};

const resolveUserMessageStateFromPendingAssistant = (
  session: ReturnType<EventStreamRuntime["getSession"]>,
  messageId: string,
): AgentUserMessageState => {
  const activeAssistantMessageId = session?.activeAssistantMessageId;
  if (!session || !activeAssistantMessageId) {
    return "read";
  }

  return messageId > activeAssistantMessageId ? "queued" : "read";
};

const resolveLiveUserMessageState = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    visible: string;
    parts: AgentUserMessageDisplayPart[];
    explicitState?: AgentUserMessageState;
    model?: ReturnType<typeof readMessageModelSelection>;
    matchedQueuedSend?: QueuedUserMessageSend | null;
  },
): AgentUserMessageState => {
  const session = runtime.getSession(runtime.externalSessionId);
  const pendingAssistantState = resolveUserMessageStateFromPendingAssistant(
    session,
    input.messageId,
  );
  const matchedQueuedSend = input.matchedQueuedSend;

  if (matchedQueuedSend && pendingAssistantState === "queued") {
    return "queued";
  }

  if (input.explicitState) {
    return input.explicitState;
  }

  return pendingAssistantState;
};

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
    normalizedParts: import("@opencode-ai/sdk/v2/client").Part[];
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
      visible,
      parts: displayParts,
      matchedQueuedSend,
      ...(explicitState ? { explicitState } : {}),
      ...(input.messageModel ? { model: input.messageModel } : {}),
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
      visible,
      parts: displayParts,
      matchedQueuedSend,
      ...(metadata?.model ? { model: metadata.model } : {}),
    }),
    ...(metadata?.model ? { model: metadata.model } : {}),
  });
};
