import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import {
  appendSessionMessage,
  createSessionMessagesState,
  findSessionMessageById,
  forEachSessionMessage,
  getSessionMessagesSlice,
  isFinalAssistantChatMessage,
} from "./messages";
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

const parseReasoningScopedPartId = (id: string) => parseScopedPartId(id, "thinking:");

const parseToolScopedPartId = (id: string) => parseScopedPartId(id, "tool:");

const isTerminalToolStatus = (status: "pending" | "running" | "completed" | "error") =>
  status === "completed" || status === "error";

const isTerminalSubagentStatus = (status: SubagentMessage["meta"]["status"]): boolean =>
  status === "completed" || status === "cancelled" || status === "error";

const mergeReasoningMessages = (
  hydratedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage,
): AgentChatMessage => {
  if (hydratedMessage.meta?.kind !== "reasoning" || currentMessage.meta?.kind !== "reasoning") {
    return currentMessage;
  }
  if (currentMessage.meta.completed && !hydratedMessage.meta.completed) {
    return currentMessage;
  }

  return hydratedMessage;
};

const mergeToolMessages = (
  hydratedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage,
): AgentChatMessage => {
  if (hydratedMessage.meta?.kind !== "tool" || currentMessage.meta?.kind !== "tool") {
    return currentMessage;
  }

  if (
    isTerminalToolStatus(currentMessage.meta.status) &&
    !isTerminalToolStatus(hydratedMessage.meta.status)
  ) {
    return currentMessage;
  }

  const nextMeta = {
    ...hydratedMessage.meta,
    ...(hydratedMessage.meta.observedStartedAtMs === undefined &&
    currentMessage.meta.observedStartedAtMs !== undefined
      ? { observedStartedAtMs: currentMessage.meta.observedStartedAtMs }
      : {}),
    ...(hydratedMessage.meta.observedEndedAtMs === undefined &&
    currentMessage.meta.observedEndedAtMs !== undefined
      ? { observedEndedAtMs: currentMessage.meta.observedEndedAtMs }
      : {}),
    ...(hydratedMessage.meta.inputReadyAtMs === undefined &&
    currentMessage.meta.inputReadyAtMs !== undefined
      ? { inputReadyAtMs: currentMessage.meta.inputReadyAtMs }
      : {}),
  };

  return {
    ...hydratedMessage,
    meta: nextMeta,
  };
};

const mergeSubagentMessages = (
  hydratedMessage: SubagentMessage,
  currentMessage: SubagentMessage,
): AgentChatMessage => {
  const hydratedMeta = hydratedMessage.meta;
  const currentMeta = currentMessage.meta;
  const prefersCurrentTerminalState =
    isTerminalSubagentStatus(currentMeta.status) && !isTerminalSubagentStatus(hydratedMeta.status);
  const description = prefersCurrentTerminalState
    ? (currentMeta.description ?? hydratedMeta.description)
    : (hydratedMeta.description ?? currentMeta.description);
  const nextMeta = mergeSubagentMeta(hydratedMeta, {
    ...currentMeta,
    partId: hydratedMeta.partId,
    correlationKey: hydratedMeta.correlationKey,
    ...(typeof description === "string" ? { description } : {}),
  });

  return {
    ...hydratedMessage,
    content: formatSubagentContent(nextMeta),
    meta: nextMeta,
  };
};

const matchesHydratedReasoning = (
  hydratedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (hydratedMessage.meta?.kind !== "reasoning" || candidate.meta?.kind !== "reasoning") {
    return false;
  }
  if (candidate.id === hydratedMessage.id) {
    return false;
  }
  if (hydratedMessage.meta.partId !== candidate.meta.partId) {
    return false;
  }

  const hydratedScopedId = parseReasoningScopedPartId(hydratedMessage.id);
  const candidateScopedId = parseReasoningScopedPartId(candidate.id);
  return (
    hydratedScopedId !== null &&
    candidateScopedId !== null &&
    hydratedScopedId.messageId === candidateScopedId.messageId
  );
};

const matchesHydratedTool = (
  hydratedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (hydratedMessage.meta?.kind !== "tool" || candidate.meta?.kind !== "tool") {
    return false;
  }
  if (candidate.id === hydratedMessage.id) {
    return false;
  }
  if (hydratedMessage.meta.tool !== candidate.meta.tool) {
    return false;
  }

  const hydratedScopedId = parseToolScopedPartId(hydratedMessage.id);
  const candidateScopedId = parseToolScopedPartId(candidate.id);
  if (
    hydratedScopedId === null ||
    candidateScopedId === null ||
    hydratedScopedId.messageId !== candidateScopedId.messageId
  ) {
    return false;
  }

  const hydratedCallId = hydratedMessage.meta.callId.trim();
  const candidateCallId = candidate.meta.callId.trim();
  if (hydratedCallId.length > 0 && candidateCallId.length > 0) {
    return hydratedCallId === candidateCallId;
  }

  return hydratedMessage.meta.partId === candidate.meta.partId;
};

const matchesHydratedSubagent = (
  hydratedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (!isSubagentMessage(hydratedMessage) || !isSubagentMessage(candidate)) {
    return false;
  }
  if (candidate.id === hydratedMessage.id) {
    return false;
  }

  const hydratedSessionId = hydratedMessage.meta.sessionId;
  if (hydratedSessionId) {
    return candidate.meta.sessionId === hydratedSessionId;
  }

  return false;
};

const canAbsorbHydratedPartSubagentIntoCurrentSessionRow = (
  hydratedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (!isSubagentMessage(hydratedMessage) || !isSubagentMessage(candidate)) {
    return false;
  }
  if (hydratedMessage.meta.sessionId || !candidate.meta.sessionId) {
    return false;
  }
  if (!hydratedMessage.meta.correlationKey.startsWith("part:")) {
    return false;
  }
  if (!candidate.meta.correlationKey.startsWith("session:")) {
    return false;
  }

  const hydratedAgent = hydratedMessage.meta.agent?.trim();
  const candidateAgent = candidate.meta.agent?.trim();
  const hydratedPrompt = hydratedMessage.meta.prompt?.trim();
  const candidatePrompt = candidate.meta.prompt?.trim();

  if (!hydratedAgent || !candidateAgent || !hydratedPrompt || !candidatePrompt) {
    return false;
  }

  return hydratedAgent === candidateAgent && hydratedPrompt === candidatePrompt;
};

const findMatchingCurrentNonSubagentMessages = ({
  currentOwner,
  hydratedMessage,
  sameIdCurrentMessage,
}: {
  currentOwner: Pick<AgentSessionState, "sessionId" | "messages">;
  hydratedMessage: AgentChatMessage;
  sameIdCurrentMessage: AgentChatMessage | undefined;
}): AgentChatMessage[] => {
  const matches = sameIdCurrentMessage ? [sameIdCurrentMessage] : [];
  const seenIds = new Set(matches.map((message) => message.id));
  const currentSlice = getSessionMessagesSlice(currentOwner, 0);
  for (let index = currentSlice.length - 1; index >= 0; index -= 1) {
    const candidate = currentSlice[index];
    if (!candidate || seenIds.has(candidate.id)) {
      continue;
    }
    if (
      matchesHydratedReasoning(hydratedMessage, candidate) ||
      matchesHydratedTool(hydratedMessage, candidate)
    ) {
      matches.push(candidate);
      seenIds.add(candidate.id);
    }
  }
  return matches;
};

const findMatchingCurrentSubagentMessages = ({
  currentOwner,
  hydratedMessage,
  sameIdCurrentMessage,
}: {
  currentOwner: Pick<AgentSessionState, "sessionId" | "messages">;
  hydratedMessage: AgentChatMessage;
  sameIdCurrentMessage: AgentChatMessage | undefined;
}): AgentChatMessage[] => {
  const matches: AgentChatMessage[] = [];
  const seenIds = new Set<string>();
  if (sameIdCurrentMessage) {
    matches.push(sameIdCurrentMessage);
    seenIds.add(sameIdCurrentMessage.id);
  }

  const currentSlice = getSessionMessagesSlice(currentOwner, 0);
  const fallbackCandidates: AgentChatMessage[] = [];
  for (let index = currentSlice.length - 1; index >= 0; index -= 1) {
    const candidate = currentSlice[index];
    if (!candidate || seenIds.has(candidate.id)) {
      continue;
    }
    if (matchesHydratedSubagent(hydratedMessage, candidate)) {
      matches.push(candidate);
      seenIds.add(candidate.id);
      continue;
    }
    if (canAbsorbHydratedPartSubagentIntoCurrentSessionRow(hydratedMessage, candidate)) {
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
  hydratedMessage,
  sameIdCurrentMessage,
}: {
  currentOwner: Pick<AgentSessionState, "sessionId" | "messages">;
  hydratedMessage: AgentChatMessage;
  sameIdCurrentMessage: AgentChatMessage | undefined;
}): AgentChatMessage[] => {
  if (isSubagentMessage(hydratedMessage)) {
    return findMatchingCurrentSubagentMessages({
      currentOwner,
      hydratedMessage,
      sameIdCurrentMessage,
    });
  }

  return findMatchingCurrentNonSubagentMessages({
    currentOwner,
    hydratedMessage,
    sameIdCurrentMessage,
  });
};

const mergeSameMessageId = (
  hydratedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage | undefined,
): AgentChatMessage => {
  if (!currentMessage) {
    return hydratedMessage;
  }

  const hydratedIsQueuedUser =
    hydratedMessage.role === "user" &&
    hydratedMessage.meta?.kind === "user" &&
    hydratedMessage.meta.state === "queued";
  const currentIsQueuedUser =
    currentMessage.role === "user" &&
    currentMessage.meta?.kind === "user" &&
    currentMessage.meta.state === "queued";

  if (currentIsQueuedUser && !hydratedIsQueuedUser) {
    const mergedMeta =
      currentMessage.meta && hydratedMessage.meta
        ? { ...currentMessage.meta, ...hydratedMessage.meta }
        : (hydratedMessage.meta ?? currentMessage.meta);
    return {
      ...currentMessage,
      ...hydratedMessage,
      ...(mergedMeta ? { meta: mergedMeta } : {}),
    };
  }

  if (
    isFinalAssistantChatMessage(hydratedMessage) &&
    currentMessage.role === "assistant" &&
    !isFinalAssistantChatMessage(currentMessage)
  ) {
    const mergedMeta =
      currentMessage.meta && hydratedMessage.meta
        ? { ...currentMessage.meta, ...hydratedMessage.meta }
        : (hydratedMessage.meta ?? currentMessage.meta);
    return {
      ...currentMessage,
      ...hydratedMessage,
      ...(mergedMeta ? { meta: mergedMeta } : {}),
    };
  }

  if (isSubagentMessage(hydratedMessage) && isSubagentMessage(currentMessage)) {
    return mergeSubagentMessages(hydratedMessage, currentMessage);
  }

  if (hydratedMessage.meta?.kind === "reasoning" && currentMessage.meta?.kind === "reasoning") {
    return mergeReasoningMessages(hydratedMessage, currentMessage);
  }

  if (hydratedMessage.meta?.kind === "tool" && currentMessage.meta?.kind === "tool") {
    return mergeToolMessages(hydratedMessage, currentMessage);
  }

  return currentMessage;
};

export const mergeHydratedMessages = (
  sessionId: string,
  hydratedMessages: AgentSessionState["messages"],
  currentMessages: AgentSessionState["messages"],
): AgentSessionState["messages"] => {
  const currentOwner = { sessionId, messages: currentMessages };
  const hydratedOwner = { sessionId, messages: hydratedMessages };
  const hydratedMessageIds = new Set<string>();
  const absorbedCurrentMessageIds = new Set<string>();
  let mergedMessages = createSessionMessagesState(sessionId);

  forEachSessionMessage(hydratedOwner, (message) => {
    const sameIdCurrentMessage = findSessionMessageById(currentOwner, message.id);
    const matchingCurrentMessages = findMatchingCurrentMessages({
      currentOwner,
      hydratedMessage: message,
      sameIdCurrentMessage,
    });
    hydratedMessageIds.add(message.id);
    for (const matchingCurrentMessage of matchingCurrentMessages) {
      absorbedCurrentMessageIds.add(matchingCurrentMessage.id);
    }
    const mergedMessage = matchingCurrentMessages.reduce<AgentChatMessage>(
      (currentMerged, matchingCurrentMessage) =>
        mergeSameMessageId(currentMerged, matchingCurrentMessage),
      message,
    );
    mergedMessages = appendSessionMessage({ sessionId, messages: mergedMessages }, mergedMessage);
  });

  forEachSessionMessage(currentOwner, (message) => {
    if (hydratedMessageIds.has(message.id) || absorbedCurrentMessageIds.has(message.id)) {
      return;
    }
    mergedMessages = appendSessionMessage({ sessionId, messages: mergedMessages }, message);
  });

  return mergedMessages;
};
