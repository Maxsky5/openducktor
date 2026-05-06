import type { AgentUserMessageDisplayPart, AgentUserMessageState } from "@openducktor/core";
import type { readMessageModelSelection } from "../../message-normalizers";
import type { SessionMessageMetadata } from "../../types";
import type { EventStreamRuntime } from "../shared";
import { buildKnownUserMessageContent } from "./user-display";

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
