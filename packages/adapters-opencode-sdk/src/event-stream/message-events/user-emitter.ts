import type {
  AgentSessionHistoryMessage,
  AgentUserMessageDisplayPart,
  AgentUserMessageState,
} from "@openducktor/core";
import {
  ensureVisibleUserTextDisplayParts,
  normalizeUserMessageDisplayParts,
  type readMessageModelSelection,
  readVisibleUserTextFromDisplayParts,
} from "../../message-normalizers";
import type { SessionMessageMetadata } from "../../types";
import type { EventStreamRuntime } from "../shared";
import { getKnownMessageParts } from "./helpers";

export const persistUserMessageMetadata = (input: {
  session: ReturnType<EventStreamRuntime["getSession"]>;
  messageId: string;
  timestamp: string;
  metadata?: SessionMessageMetadata;
  model?: ReturnType<typeof readMessageModelSelection>;
  visible: string;
  displayParts: AgentUserMessageDisplayPart[];
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

const buildKnownUserMessageContent = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    visible?: string;
    displayParts?: AgentUserMessageDisplayPart[];
  },
): { visible: string; displayParts: AgentUserMessageDisplayPart[] } | null => {
  const session = runtime.getSession(runtime.externalSessionId);
  const metadata = session?.messageMetadataById.get(input.messageId);
  const fallbackText = metadata?.text ?? "";
  let displayParts = input.displayParts;
  if (displayParts === undefined) {
    const knownDisplayParts = normalizeUserMessageDisplayParts(
      getKnownMessageParts(runtime, input.messageId),
    );
    displayParts = ensureVisibleUserTextDisplayParts(
      knownDisplayParts.length > 0 ? knownDisplayParts : (metadata?.displayParts ?? []),
      fallbackText,
    );
  }
  const textFromParts = input.visible ?? readVisibleUserTextFromDisplayParts(displayParts);
  const visible = textFromParts.length > 0 ? textFromParts : fallbackText;
  if (visible.trim().length === 0 && displayParts.length === 0) {
    return null;
  }

  return { visible, displayParts };
};

export const emitUserMessage = (
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

export const emitKnownUserMessage = (
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
  const content = buildKnownUserMessageContent(runtime, input);
  if (!content) {
    return false;
  }

  return emitUserMessage(runtime, {
    messageId: input.messageId,
    timestamp: input.timestamp,
    message: content.visible,
    parts: content.displayParts,
    state: input.state,
    ...(input.model ? { model: input.model } : {}),
  });
};

export const emitAdmittedUserMessage = (
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
  runtime.messageRoleById.set(input.messageId, "user");
  persistUserMessageMetadata({
    session,
    messageId: input.messageId,
    timestamp: input.timestamp,
    ...(input.model ? { model: input.model } : {}),
    visible: input.message,
    displayParts: input.parts,
  });

  return emitUserMessage(runtime, input);
};

type UserHistoryMessage = Extract<AgentSessionHistoryMessage, { role: "user" }>;

const seedHistoryUserMessageMetadata = (
  runtime: EventStreamRuntime,
  message: UserHistoryMessage,
): ReturnType<EventStreamRuntime["getSession"]> => {
  const session = runtime.getSession(runtime.externalSessionId);
  runtime.messageRoleById.set(message.messageId, "user");
  persistUserMessageMetadata({
    session,
    messageId: message.messageId,
    timestamp: message.timestamp,
    ...(message.model ? { model: message.model } : {}),
    visible: message.text,
    displayParts: message.displayParts,
  });

  return session;
};

export const seedHistoryUserMessage = (
  runtime: EventStreamRuntime,
  message: UserHistoryMessage,
): boolean => {
  const session = seedHistoryUserMessageMetadata(runtime, message);
  session?.emittedUserMessageSignatures.set(
    message.messageId,
    buildUserMessageSignature({
      timestamp: message.timestamp,
      message: message.text,
      parts: message.displayParts,
      state: message.state,
      ...(message.model ? { model: message.model } : {}),
    }),
  );
  session?.emittedUserMessageStates.set(message.messageId, message.state);
  return true;
};

export const emitHistoryUserMessage = (
  runtime: EventStreamRuntime,
  message: UserHistoryMessage,
): boolean => {
  seedHistoryUserMessageMetadata(runtime, message);
  return emitUserMessage(runtime, {
    messageId: message.messageId,
    timestamp: message.timestamp,
    message: message.text,
    parts: message.displayParts,
    state: message.state,
    ...(message.model ? { model: message.model } : {}),
  });
};
