import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { matchesLoadedTool, mergeToolMessages } from "./history-tool-message-merge";
import { applyPreferredMessageTimestamp } from "./message-timestamp";
import { sessionMessageTimestampInsertionIndex } from "./message-timestamp-ordering";
import {
  createSessionMessagesState,
  findSessionMessageById,
  forEachSessionMessage,
  getSessionMessagesSlice,
  isFinalAssistantChatMessage,
  someSessionMessage,
} from "./messages";
import { isSessionSystemPromptMessage } from "./session-prompt";
import {
  findCurrentSubagentMessagesForLoadedHistory,
  isSubagentMessage,
  mergeSubagentMessages,
} from "./subagent-messages";

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

  return applyPreferredMessageTimestamp(loadedMessage, loadedMessage, currentMessage);
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

const isUserMessage = (
  message: AgentChatMessage,
): message is AgentChatMessage & {
  role: "user";
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "user" }>;
} => message.role === "user" && message.meta?.kind === "user";

const LOCAL_ACCEPTED_USER_CONFIRMATION_WINDOW_MS = 10_000;

const userMessageTimestampMs = (timestamp: string): number | null => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
};

const insertSubagentMessageByTimestamp = (
  messages: AgentChatMessage[],
  message: AgentChatMessage,
): void => {
  if (!isSubagentMessage(message)) {
    messages.push(message);
    return;
  }
  const insertIndex = sessionMessageTimestampInsertionIndex(messages, message);
  messages.splice(insertIndex, 0, message);
};

const confirmsLocalAcceptedUserMessage = (
  loadedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage,
): number | null => {
  if (
    !isUserMessage(loadedMessage) ||
    !isUserMessage(currentMessage) ||
    loadedMessage.meta.state !== "read" ||
    currentMessage.meta.state !== "read" ||
    loadedMessage.content !== currentMessage.content
  ) {
    return null;
  }

  const loadedTimestampMs = userMessageTimestampMs(loadedMessage.timestamp);
  const currentTimestampMs = userMessageTimestampMs(currentMessage.timestamp);
  if (loadedTimestampMs === null || currentTimestampMs === null) {
    return null;
  }

  const distanceMs = Math.abs(loadedTimestampMs - currentTimestampMs);
  return distanceMs <= LOCAL_ACCEPTED_USER_CONFIRMATION_WINDOW_MS ? distanceMs : null;
};

const findConfirmedLocalAcceptedUserMessage = ({
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
  if (matches.length > 0) {
    return matches;
  }

  const currentSlice = getSessionMessagesSlice(currentOwner, 0);
  let nearestMatch: { message: AgentChatMessage; distanceMs: number } | null = null;
  for (let index = currentSlice.length - 1; index >= 0; index -= 1) {
    const candidate = currentSlice[index];
    if (!candidate || absorbedCurrentMessageIds.has(candidate.id)) {
      continue;
    }
    const distanceMs = confirmsLocalAcceptedUserMessage(loadedMessage, candidate);
    if (distanceMs === null) {
      continue;
    }
    if (!nearestMatch || distanceMs < nearestMatch.distanceMs) {
      nearestMatch = { message: candidate, distanceMs };
    }
  }

  if (nearestMatch) {
    return [nearestMatch.message];
  }

  return [];
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
    return findCurrentSubagentMessagesForLoadedHistory({
      currentOwner,
      loadedMessage,
      sameIdCurrentMessage,
      absorbedCurrentMessageIds,
    });
  }

  if (isUserMessage(loadedMessage)) {
    return findConfirmedLocalAcceptedUserMessage({
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
    return applyPreferredMessageTimestamp(
      {
        ...loadedMessage,
        ...currentMessage,
        meta,
      },
      currentMessage,
      loadedMessage,
    );
  }

  if (isFinalAssistantChatMessage(loadedMessage) && currentMessage.role === "assistant") {
    const mergedMeta =
      currentMessage.meta && loadedMessage.meta
        ? { ...currentMessage.meta, ...loadedMessage.meta }
        : (loadedMessage.meta ?? currentMessage.meta);
    return applyPreferredMessageTimestamp(
      {
        ...currentMessage,
        ...loadedMessage,
        ...(mergedMeta ? { meta: mergedMeta } : {}),
      },
      loadedMessage,
      currentMessage,
    );
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
  const loadedHasSystemPrompt = someSessionMessage(loadedOwner, isSessionSystemPromptMessage);
  const loadedMessageIds = new Set<string>();
  const absorbedCurrentMessageIds = new Set<string>();
  const mergedMessages: AgentChatMessage[] = [];

  if (!loadedHasSystemPrompt) {
    forEachSessionMessage(currentOwner, (message) => {
      if (!isSessionSystemPromptMessage(message)) {
        return;
      }
      absorbedCurrentMessageIds.add(message.id);
      mergedMessages.push(message);
    });
  }

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
    mergedMessages.push(mergedMessage);
  });

  forEachSessionMessage(currentOwner, (message) => {
    if (loadedMessageIds.has(message.id) || absorbedCurrentMessageIds.has(message.id)) {
      return;
    }
    if (isSessionSystemPromptMessage(message)) {
      return;
    }
    insertSubagentMessageByTimestamp(mergedMessages, message);
  });

  return createSessionMessagesState(externalSessionId, mergedMessages, currentMessages.version + 1);
};
