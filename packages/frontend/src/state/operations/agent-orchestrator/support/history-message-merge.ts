import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { toToolMessageId } from "./chat-message-ids";
import {
  appendSessionMessage,
  createSessionMessagesState,
  findSessionMessageById,
  forEachSessionMessage,
  getSessionMessagesSlice,
  isFinalAssistantChatMessage,
} from "./messages";
import { isSessionSystemPromptMessage } from "./session-prompt";
import {
  formatSubagentContent,
  isSubagentMessage,
  mergeSubagentMeta,
  type SubagentMessage,
} from "./subagent-messages";

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

const chooseSubagentDescription = (
  loadedMeta: SubagentMessage["meta"],
  currentMeta: SubagentMessage["meta"],
  resolvedStatus: SubagentMessage["meta"]["status"],
): string | undefined => {
  const currentMatchesResolvedStatus = currentMeta.status === resolvedStatus;
  const loadedMatchesResolvedStatus = loadedMeta.status === resolvedStatus;

  if (currentMatchesResolvedStatus && !loadedMatchesResolvedStatus) {
    return currentMeta.description ?? loadedMeta.description;
  }
  if (loadedMatchesResolvedStatus && !currentMatchesResolvedStatus) {
    return loadedMeta.description ?? currentMeta.description;
  }

  return loadedMeta.description ?? currentMeta.description;
};

const mergeReasoningMessages = (
  loadedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage,
): AgentChatMessage => {
  if (loadedMessage.meta?.kind !== "reasoning" || currentMessage.meta?.kind !== "reasoning") {
    return currentMessage;
  }
  if (currentMessage.meta.completed && !loadedMessage.meta.completed) {
    return currentMessage;
  }
  if (!currentMessage.meta.completed && !loadedMessage.meta.completed) {
    return currentMessage;
  }

  return loadedMessage;
};

const mergeToolMessages = (
  loadedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage,
): AgentChatMessage => {
  if (loadedMessage.meta?.kind !== "tool" || currentMessage.meta?.kind !== "tool") {
    return currentMessage;
  }

  if (shouldPreserveCurrentToolMessage(loadedMessage.meta.status, currentMessage.meta.status)) {
    return preserveCurrentToolWithLoadedIdentity(loadedMessage, currentMessage);
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

  return {
    ...loadedMessage,
    meta: nextMeta,
  };
};

const mergeSubagentMessages = (
  loadedMessage: SubagentMessage,
  currentMessage: SubagentMessage,
): AgentChatMessage => {
  const loadedMeta = loadedMessage.meta;
  const currentMeta = currentMessage.meta;
  const nextMeta = mergeSubagentMeta(loadedMeta, {
    ...currentMeta,
    partId: loadedMeta.partId,
    correlationKey: loadedMeta.correlationKey,
  });
  const description = chooseSubagentDescription(loadedMeta, currentMeta, nextMeta.status);
  const resolvedMeta = {
    ...nextMeta,
    ...(typeof description === "string" ? { description } : {}),
  };

  return {
    ...loadedMessage,
    content: formatSubagentContent(resolvedMeta),
    meta: resolvedMeta,
  };
};

const matchesLoadedTool = (
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

  const loadedScopedId = parseToolScopedPartId(loadedMessage.id);
  const candidateScopedId = parseToolScopedPartId(candidate.id);
  if (
    loadedScopedId === null ||
    candidateScopedId === null ||
    loadedScopedId.messageId !== candidateScopedId.messageId
  ) {
    return false;
  }

  const loadedCallId = trimToolCallId(loadedMessage.meta.callId);
  const candidateCallId = trimToolCallId(candidate.meta.callId);
  if (loadedCallId.length > 0 && candidateCallId.length > 0) {
    return loadedCallId === candidateCallId;
  }

  return loadedMessage.meta.partId === candidate.meta.partId;
};

const matchesLoadedSubagent = (
  loadedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (!isSubagentMessage(loadedMessage) || !isSubagentMessage(candidate)) {
    return false;
  }
  if (candidate.id === loadedMessage.id) {
    return false;
  }

  const loadedSessionId = loadedMessage.meta.externalSessionId;
  if (loadedSessionId) {
    return candidate.meta.externalSessionId === loadedSessionId;
  }

  return false;
};

const canAbsorbLoadedPartSubagentIntoCurrentSessionRow = (
  loadedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (!isSubagentMessage(loadedMessage) || !isSubagentMessage(candidate)) {
    return false;
  }
  if (loadedMessage.meta.externalSessionId || !candidate.meta.externalSessionId) {
    return false;
  }
  if (!loadedMessage.meta.correlationKey.startsWith("part:")) {
    return false;
  }
  if (!candidate.meta.correlationKey.startsWith("session:")) {
    return false;
  }

  const loadedAgent = loadedMessage.meta.agent?.trim();
  const candidateAgent = candidate.meta.agent?.trim();
  const loadedPrompt = loadedMessage.meta.prompt?.trim();
  const candidatePrompt = candidate.meta.prompt?.trim();

  if (!loadedAgent || !candidateAgent || !loadedPrompt || !candidatePrompt) {
    return false;
  }

  return loadedAgent === candidateAgent && loadedPrompt === candidatePrompt;
};

const findMatchingCurrentNonSubagentMessages = ({
  currentOwner,
  loadedMessage,
  sameIdCurrentMessage,
  absorbedCurrentMessageIds,
}: {
  currentOwner: Pick<AgentSessionState, "externalSessionId" | "messages">;
  loadedMessage: AgentChatMessage;
  sameIdCurrentMessage: AgentChatMessage | undefined;
  absorbedCurrentMessageIds: ReadonlySet<string>;
}): AgentChatMessage[] => {
  const matches =
    sameIdCurrentMessage && !absorbedCurrentMessageIds.has(sameIdCurrentMessage.id)
      ? [sameIdCurrentMessage]
      : [];
  const seenIds = new Set(matches.map((message) => message.id));
  const currentSlice = getSessionMessagesSlice(currentOwner, 0);
  for (let index = currentSlice.length - 1; index >= 0; index -= 1) {
    const candidate = currentSlice[index];
    if (!candidate || seenIds.has(candidate.id) || absorbedCurrentMessageIds.has(candidate.id)) {
      continue;
    }
    if (matchesLoadedTool(loadedMessage, candidate)) {
      matches.push(candidate);
      seenIds.add(candidate.id);
    }
  }
  return matches;
};

const findMatchingCurrentSubagentMessages = ({
  currentOwner,
  loadedMessage,
  sameIdCurrentMessage,
  absorbedCurrentMessageIds,
}: {
  currentOwner: Pick<AgentSessionState, "externalSessionId" | "messages">;
  loadedMessage: AgentChatMessage;
  sameIdCurrentMessage: AgentChatMessage | undefined;
  absorbedCurrentMessageIds: ReadonlySet<string>;
}): AgentChatMessage[] => {
  const matches: AgentChatMessage[] = [];
  const seenIds = new Set<string>();
  if (sameIdCurrentMessage && !absorbedCurrentMessageIds.has(sameIdCurrentMessage.id)) {
    matches.push(sameIdCurrentMessage);
    seenIds.add(sameIdCurrentMessage.id);
  }

  const currentSlice = getSessionMessagesSlice(currentOwner, 0);
  const fallbackCandidates: AgentChatMessage[] = [];
  for (let index = currentSlice.length - 1; index >= 0; index -= 1) {
    const candidate = currentSlice[index];
    if (!candidate || seenIds.has(candidate.id) || absorbedCurrentMessageIds.has(candidate.id)) {
      continue;
    }
    if (matchesLoadedSubagent(loadedMessage, candidate)) {
      matches.push(candidate);
      seenIds.add(candidate.id);
      continue;
    }
    if (canAbsorbLoadedPartSubagentIntoCurrentSessionRow(loadedMessage, candidate)) {
      fallbackCandidates.push(candidate);
    }
  }

  if (matches.length === 0 && fallbackCandidates.length === 1) {
    const [fallbackCandidate] = fallbackCandidates;
    if (fallbackCandidate) {
      matches.push(fallbackCandidate);
    }
  }

  return matches;
};

const findMatchingCurrentMessages = ({
  currentOwner,
  loadedMessage,
  sameIdCurrentMessage,
  absorbedCurrentMessageIds,
}: {
  currentOwner: Pick<AgentSessionState, "externalSessionId" | "messages">;
  loadedMessage: AgentChatMessage;
  sameIdCurrentMessage: AgentChatMessage | undefined;
  absorbedCurrentMessageIds: ReadonlySet<string>;
}): AgentChatMessage[] => {
  if (isSubagentMessage(loadedMessage)) {
    return findMatchingCurrentSubagentMessages({
      currentOwner,
      loadedMessage,
      sameIdCurrentMessage,
      absorbedCurrentMessageIds,
    });
  }

  return findMatchingCurrentNonSubagentMessages({
    currentOwner,
    loadedMessage,
    sameIdCurrentMessage,
    absorbedCurrentMessageIds,
  });
};

const mergeSameMessageId = (
  loadedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage | undefined,
): AgentChatMessage => {
  if (!currentMessage) {
    return loadedMessage;
  }

  if (isSessionSystemPromptMessage(loadedMessage) && isSessionSystemPromptMessage(currentMessage)) {
    return loadedMessage;
  }

  if (
    loadedMessage.role === "user" &&
    loadedMessage.meta?.kind === "user" &&
    currentMessage.role === "user" &&
    currentMessage.meta?.kind === "user"
  ) {
    return {
      ...currentMessage,
      ...loadedMessage,
      meta: {
        ...currentMessage.meta,
        ...loadedMessage.meta,
      },
    };
  }

  if (isFinalAssistantChatMessage(loadedMessage) && currentMessage.role === "assistant") {
    const mergedMeta =
      currentMessage.meta && loadedMessage.meta
        ? { ...currentMessage.meta, ...loadedMessage.meta }
        : (loadedMessage.meta ?? currentMessage.meta);
    return {
      ...currentMessage,
      ...loadedMessage,
      ...(mergedMeta ? { meta: mergedMeta } : {}),
    };
  }

  if (isSubagentMessage(loadedMessage) && isSubagentMessage(currentMessage)) {
    return mergeSubagentMessages(loadedMessage, currentMessage);
  }

  if (loadedMessage.meta?.kind === "reasoning" && currentMessage.meta?.kind === "reasoning") {
    return mergeReasoningMessages(loadedMessage, currentMessage);
  }

  if (loadedMessage.meta?.kind === "tool" && currentMessage.meta?.kind === "tool") {
    return mergeToolMessages(loadedMessage, currentMessage);
  }

  return currentMessage;
};

export const mergeHistoryMessages = (
  externalSessionId: string,
  loadedMessages: AgentSessionState["messages"],
  currentMessages: AgentSessionState["messages"],
): AgentSessionState["messages"] => {
  const currentOwner = { externalSessionId, messages: currentMessages };
  const loadedOwner = { externalSessionId, messages: loadedMessages };
  const loadedMessageIds = new Set<string>();
  const absorbedCurrentMessageIds = new Set<string>();
  let mergedMessages = createSessionMessagesState(externalSessionId);

  forEachSessionMessage(loadedOwner, (message) => {
    const sameIdCurrentMessage = findSessionMessageById(currentOwner, message.id);
    const matchingCurrentMessages = findMatchingCurrentMessages({
      currentOwner,
      loadedMessage: message,
      sameIdCurrentMessage,
      absorbedCurrentMessageIds,
    });
    loadedMessageIds.add(message.id);
    for (const matchingCurrentMessage of matchingCurrentMessages) {
      absorbedCurrentMessageIds.add(matchingCurrentMessage.id);
    }
    const mergedMessage = matchingCurrentMessages.reduce<AgentChatMessage>(
      (currentMerged, matchingCurrentMessage) =>
        mergeSameMessageId(currentMerged, matchingCurrentMessage),
      message,
    );
    mergedMessages = appendSessionMessage(
      { externalSessionId, messages: mergedMessages },
      mergedMessage,
    );
  });

  forEachSessionMessage(currentOwner, (message) => {
    if (loadedMessageIds.has(message.id) || absorbedCurrentMessageIds.has(message.id)) {
      return;
    }
    mergedMessages = appendSessionMessage({ externalSessionId, messages: mergedMessages }, message);
  });

  return mergedMessages;
};
