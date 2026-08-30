import type { AgentUserMessageDisplayPart, AgentUserMessageState } from "@openducktor/core";
import {
  ensureVisibleUserTextDisplayParts,
  normalizeUserMessageDisplayParts,
  type readMessageModelSelection,
  readVisibleUserTextFromDisplayParts,
} from "../../message-normalizers";
import type { SessionMessageMetadata, SessionRecord } from "../../types";
import type { EventStreamRuntime } from "../shared";
import { getKnownMessageParts } from "./helpers";

export const persistUserMessageMetadata = (input: {
  session: SessionRecord;
  messageId: string;
  timestamp: string;
  metadata?: SessionMessageMetadata;
  model?: ReturnType<typeof readMessageModelSelection>;
  visible: string;
  displayParts: AgentUserMessageDisplayPart[];
}): void => {
  const metadata: SessionMessageMetadata = {
    timestamp: input.metadata?.timestamp ?? input.timestamp,
    text: input.visible,
  };
  const model = input.model ?? input.metadata?.model;
  if (model) {
    metadata.model = model;
  }
  if (input.metadata?.parentId) {
    metadata.parentId = input.metadata.parentId;
  }
  if (input.displayParts.length > 0) {
    metadata.displayParts = input.displayParts;
  }
  input.session.messageMetadataById.set(input.messageId, metadata);
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

type KnownUserMessageContent = {
  displayParts: AgentUserMessageDisplayPart[];
  visible: string;
};

const buildKnownUserMessageContent = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    visible?: string;
    displayParts?: AgentUserMessageDisplayPart[];
  },
): KnownUserMessageContent | null => {
  const { session } = runtime;
  const metadata = session.messageMetadataById.get(input.messageId);
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
  const { session } = runtime;
  const signature = buildUserMessageSignature(input);
  if (session.emittedUserMessageSignatures.get(input.messageId) === signature) {
    return true;
  }

  const event: Parameters<EventStreamRuntime["emit"]>[1] = {
    type: "user_message",
    externalSessionId: runtime.externalSessionId,
    timestamp: input.timestamp,
    messageId: input.messageId,
    message: input.message,
    parts: input.parts,
    state: input.state,
  };
  if (input.model) {
    event.model = input.model;
  }
  runtime.emit(runtime.externalSessionId, event);
  session.emittedUserMessageSignatures.set(input.messageId, signature);
  session.emittedUserMessageStates.set(input.messageId, input.state);
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

  const messageInput: Parameters<typeof emitUserMessage>[1] = {
    messageId: input.messageId,
    timestamp: input.timestamp,
    message: content.visible,
    parts: content.displayParts,
    state: input.state,
  };
  if (input.model) {
    messageInput.model = input.model;
  }
  return emitUserMessage(runtime, messageInput);
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
  const { session } = runtime;
  session.messageRoleById.set(input.messageId, "user");
  const metadataInput: Parameters<typeof persistUserMessageMetadata>[0] = {
    session,
    messageId: input.messageId,
    timestamp: input.timestamp,
    visible: input.message,
    displayParts: input.parts,
  };
  if (input.model) {
    metadataInput.model = input.model;
  }
  persistUserMessageMetadata(metadataInput);

  return emitUserMessage(runtime, input);
};
