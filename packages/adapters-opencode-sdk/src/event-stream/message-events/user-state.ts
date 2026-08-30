import type { AgentUserMessageDisplayPart, AgentUserMessageState } from "@openducktor/core";
import type { readMessageModelSelection } from "../../message-normalizers";
import type { QueuedUserMessageSend, SessionRecord } from "../../types";
import {
  buildQueuedDisplayAttachmentIdentitySignature,
  buildQueuedDisplaySignature,
} from "../../user-message-signatures";
import type { EventStreamRuntime } from "../shared";

export const takeQueuedUserSendMatch = (
  runtime: EventStreamRuntime,
  visible: string,
  parts: AgentUserMessageDisplayPart[],
  model: ReturnType<typeof readMessageModelSelection> | undefined,
): QueuedUserMessageSend | null => {
  const { session } = runtime;
  if (session.pendingQueuedUserMessages.length === 0) {
    return null;
  }

  const signatureInput: Parameters<typeof buildQueuedDisplaySignature>[0] = {
    visible,
    parts,
  };
  if (model) {
    signatureInput.model = model;
  }
  const signature = buildQueuedDisplaySignature(signatureInput);
  const attachmentIdentitySignature = buildQueuedDisplayAttachmentIdentitySignature(signatureInput);
  const modelFreeSignature = model ? buildQueuedDisplaySignature({ visible, parts }) : signature;
  const modelFreeAttachmentIdentitySignature = model
    ? buildQueuedDisplayAttachmentIdentitySignature({ visible, parts })
    : attachmentIdentitySignature;
  const exactMatchIndex = session.pendingQueuedUserMessages.findIndex(
    (entry) =>
      entry.signature === signature ||
      entry.attachmentIdentitySignature === attachmentIdentitySignature,
  );
  const matchIndex =
    exactMatchIndex >= 0
      ? exactMatchIndex
      : session.pendingQueuedUserMessages.findIndex(
          (entry) =>
            entry.signature === modelFreeSignature ||
            entry.attachmentIdentitySignature === modelFreeAttachmentIdentitySignature,
        );
  if (matchIndex < 0) {
    return null;
  }

  return session.pendingQueuedUserMessages.splice(matchIndex, 1)[0] ?? null;
};

export const resolveUserMessageStateFromPendingAssistant = (
  session: SessionRecord,
  messageId: string,
): AgentUserMessageState => {
  const activeAssistantMessageId = session.activeAssistantMessageId;
  if (!activeAssistantMessageId) {
    return "read";
  }

  return messageId > activeAssistantMessageId ? "queued" : "read";
};

export const resolveLiveUserMessageState = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    explicitState?: AgentUserMessageState;
    matchedQueuedSend?: QueuedUserMessageSend | null;
  },
): AgentUserMessageState => {
  const { session } = runtime;
  const pendingAssistantState = resolveUserMessageStateFromPendingAssistant(
    session,
    input.messageId,
  );

  if (input.matchedQueuedSend && pendingAssistantState === "queued") {
    return "queued";
  }

  if (input.explicitState) {
    return input.explicitState;
  }

  return pendingAssistantState;
};
