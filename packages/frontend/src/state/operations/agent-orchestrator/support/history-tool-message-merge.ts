import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { toToolMessageId } from "./chat-message-ids";
import { applyPreferredMessageTimestamp } from "./message-timestamp";

type ScopedPartId = {
  messageId: string;
  partKey: string;
};

type ToolStatus = "pending" | "running" | "completed" | "error";

const parseScopedPartId = (id: string, prefix: string): ScopedPartId | null => {
  if (!id.startsWith(prefix)) {
    return null;
  }

  const scopedId = id.slice(prefix.length);
  const separatorIndex = scopedId.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= scopedId.length - 1) {
    return null;
  }

  return {
    messageId: scopedId.slice(0, separatorIndex),
    partKey: scopedId.slice(separatorIndex + 1),
  };
};

const parseToolScopedPartId = (id: string) => parseScopedPartId(id, "tool:");

const isTerminalToolStatus = (status: ToolStatus) => status === "completed" || status === "error";

const toolStatusRank = (status: ToolStatus): number => {
  switch (status) {
    case "pending":
      return 0;
    case "running":
      return 1;
    case "completed":
    case "error":
      return 2;
  }
};

const trimToolCallId = (callId: string | undefined): string =>
  typeof callId === "string" ? callId.trim() : "";

const shouldPreserveCurrentToolMessage = (
  loadedStatus: ToolStatus,
  currentStatus: ToolStatus,
): boolean => {
  const loadedTerminal = isTerminalToolStatus(loadedStatus);
  const currentTerminal = isTerminalToolStatus(currentStatus);

  if (loadedTerminal !== currentTerminal) {
    return currentTerminal;
  }
  if (!loadedTerminal && !currentTerminal) {
    return toolStatusRank(currentStatus) >= toolStatusRank(loadedStatus);
  }

  return false;
};

const preserveCurrentToolWithLoadedIdentity = (
  loadedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage,
): AgentChatMessage => {
  if (loadedMessage.meta?.kind !== "tool" || currentMessage.meta?.kind !== "tool") {
    return currentMessage;
  }

  const scopedId = parseToolScopedPartId(loadedMessage.id);
  if (scopedId === null) {
    return currentMessage;
  }

  const loadedCallId = trimToolCallId(loadedMessage.meta.callId);
  const currentCallId = trimToolCallId(currentMessage.meta.callId);
  const canonicalCallId = loadedCallId || currentCallId;
  const canonicalId = toToolMessageId({
    messageId: scopedId.messageId,
    partId: loadedMessage.meta.partId,
    ...(canonicalCallId ? { callId: canonicalCallId } : {}),
  });

  return {
    ...currentMessage,
    id: canonicalId,
    meta: {
      ...currentMessage.meta,
      callId: canonicalCallId,
    },
  };
};

export const mergeToolMessages = (
  loadedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage,
): AgentChatMessage => {
  if (loadedMessage.meta?.kind !== "tool" || currentMessage.meta?.kind !== "tool") {
    return currentMessage;
  }

  if (shouldPreserveCurrentToolMessage(loadedMessage.meta.status, currentMessage.meta.status)) {
    return applyPreferredMessageTimestamp(
      preserveCurrentToolWithLoadedIdentity(loadedMessage, currentMessage),
      currentMessage,
      loadedMessage,
    );
  }

  const nextMeta = {
    ...loadedMessage.meta,
    ...(loadedMessage.meta.observedStartedAtMs === undefined &&
    currentMessage.meta.observedStartedAtMs !== undefined
      ? { observedStartedAtMs: currentMessage.meta.observedStartedAtMs }
      : {}),
    ...(loadedMessage.meta.observedEndedAtMs === undefined &&
    currentMessage.meta.observedEndedAtMs !== undefined
      ? { observedEndedAtMs: currentMessage.meta.observedEndedAtMs }
      : {}),
    ...(loadedMessage.meta.inputReadyAtMs === undefined &&
    currentMessage.meta.inputReadyAtMs !== undefined
      ? { inputReadyAtMs: currentMessage.meta.inputReadyAtMs }
      : {}),
  };

  return applyPreferredMessageTimestamp(
    {
      ...loadedMessage,
      meta: nextMeta,
    },
    loadedMessage,
    currentMessage,
  );
};

export const matchesLoadedTool = (
  loadedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (loadedMessage.meta?.kind !== "tool" || candidate.meta?.kind !== "tool") {
    return false;
  }
  if (candidate.id === loadedMessage.id) {
    return false;
  }
  if (loadedMessage.meta.tool !== candidate.meta.tool) {
    return false;
  }

  const loadedCallId = trimToolCallId(loadedMessage.meta.callId);
  const candidateCallId = trimToolCallId(candidate.meta.callId);
  if (loadedCallId.length > 0 && candidateCallId.length > 0) {
    return loadedCallId === candidateCallId;
  }

  const loadedScopedId = parseToolScopedPartId(loadedMessage.id);
  const candidateScopedId = parseToolScopedPartId(candidate.id);
  if (
    loadedScopedId === null ||
    candidateScopedId === null ||
    loadedScopedId.messageId !== candidateScopedId.messageId
  ) {
    return false;
  }

  return loadedMessage.meta.partId === candidate.meta.partId;
};
