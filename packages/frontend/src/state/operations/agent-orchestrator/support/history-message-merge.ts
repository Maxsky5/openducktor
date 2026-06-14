import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import {
  canAbsorbLoadedPartSubagentIntoCurrentSessionRow,
  matchesLoadedSubagent,
  mergeSubagentMessages,
} from "./history-subagent-message-merge";
import { matchesLoadedTool, mergeToolMessages } from "./history-tool-message-merge";
import {
  appendSessionMessage,
  createSessionMessagesState,
  findSessionMessageById,
  forEachSessionMessage,
  getSessionMessagesSlice,
  isFinalAssistantChatMessage,
} from "./messages";
import { isSessionSystemPromptMessage } from "./session-prompt";
import { isSubagentMessage } from "./subagent-messages";

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

const sameIdCurrentMessageOrEmpty = (
  currentMessage: AgentChatMessage | undefined,
  absorbedCurrentMessageIds: ReadonlySet<string>,
): AgentChatMessage[] => {
  if (!currentMessage || absorbedCurrentMessageIds.has(currentMessage.id)) {
    return [];
  }
  return [currentMessage];
};

const findMatchingCurrentToolMessages = ({
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
  const matches = sameIdCurrentMessageOrEmpty(sameIdCurrentMessage, absorbedCurrentMessageIds);
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

  if (loadedMessage.meta?.kind === "tool") {
    return findMatchingCurrentToolMessages({
      currentOwner,
      loadedMessage,
      sameIdCurrentMessage,
      absorbedCurrentMessageIds,
    });
  }

  return sameIdCurrentMessageOrEmpty(sameIdCurrentMessage, absorbedCurrentMessageIds);
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
    const parts = currentMessage.meta.parts ?? loadedMessage.meta.parts;
    const meta = {
      ...currentMessage.meta,
      ...loadedMessage.meta,
      ...(parts ? { parts } : {}),
    };
    return {
      ...loadedMessage,
      ...currentMessage,
      meta,
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
