import { mergeAgentImageGeneration } from "@openducktor/core";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import {
  matchesLoadedTool,
  mergeToolMessages,
  toolMessageMatchKeys,
} from "./history-tool-message-merge";
import { applyPreferredMessageTimestamp } from "./message-timestamp";
import {
  messageTimestampMs,
  sessionMessageTimestampInsertionIndex,
} from "./message-timestamp-ordering";
import {
  createSessionMessagesState,
  forEachSessionMessage,
  getSessionMessages,
  haveSameUserMessageAttachmentIdentity,
  isFinalAssistantChatMessage,
  someSessionMessage,
  type SessionMessageOwner,
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

type IndexedCurrentMessage = {
  index: number;
  message: AgentChatMessage;
};

/**
 * Lookup tables for the current messages. Without them the merge rescans the
 * whole current list for every loaded message, which is quadratic and stalls the
 * renderer on long sessions.
 */
type CurrentMessageIndex = {
  owner: SessionMessageOwner;
  firstById: Map<string, AgentChatMessage>;
  assistantMessagesBySourceMessageId: Map<string, IndexedCurrentMessage[]>;
  toolMessagesByCallId: Map<string, IndexedCurrentMessage[]>;
  toolMessagesByPartKey: Map<string, IndexedCurrentMessage[]>;
  readUserMessagesByMatchKey: Map<string, IndexedCurrentMessage[]>;
};

const appendIndexedMessage = (
  index: Map<string, IndexedCurrentMessage[]>,
  key: string,
  entry: IndexedCurrentMessage,
): void => {
  const existing = index.get(key);
  if (existing) {
    existing.push(entry);
    return;
  }
  index.set(key, [entry]);
};

const userMessageMatchKey = (message: AgentChatMessage): string | null => {
  if (message.meta?.kind !== "user") {
    return null;
  }
  const attachments = (message.meta.parts ?? [])
    .flatMap((part) => (part.kind === "attachment" ? [part.attachment] : []))
    .map((attachment) => `${attachment.kind}\u0001${attachment.path}`)
    .join("\u0002");
  return `${message.content}\u0000${attachments}`;
};

const buildCurrentMessageIndex = (currentOwner: SessionMessageOwner): CurrentMessageIndex => {
  const messages = getSessionMessages(currentOwner);
  const index: CurrentMessageIndex = {
    owner: currentOwner,
    firstById: new Map(),
    assistantMessagesBySourceMessageId: new Map(),
    toolMessagesByCallId: new Map(),
    toolMessagesByPartKey: new Map(),
    readUserMessagesByMatchKey: new Map(),
  };

  // Same-id lookups keep the first occurrence, like a linear forward scan.
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (message && !index.firstById.has(message.id)) {
      index.firstById.set(message.id, message);
    }
  }

  // Walk backwards so every entry list is ordered by descending message index.
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message) {
      continue;
    }
    const entry: IndexedCurrentMessage = { index: messageIndex, message };
    const toolKeys = toolMessageMatchKeys(message);
    if (toolKeys) {
      if (toolKeys.callId.length > 0) {
        appendIndexedMessage(index.toolMessagesByCallId, toolKeys.callId, entry);
      }
      if (toolKeys.partKey !== null) {
        appendIndexedMessage(index.toolMessagesByPartKey, toolKeys.partKey, entry);
      }
      continue;
    }
    if (message.role === "user" && message.meta?.kind === "user" && message.meta.state === "read") {
      const matchKey = userMessageMatchKey(message);
      if (matchKey !== null) {
        appendIndexedMessage(index.readUserMessagesByMatchKey, matchKey, entry);
      }
      continue;
    }
    if (
      message.role === "assistant" &&
      message.meta?.kind === "assistant" &&
      message.meta.sourceMessageId !== undefined
    ) {
      appendIndexedMessage(
        index.assistantMessagesBySourceMessageId,
        message.meta.sourceMessageId,
        entry,
      );
    }
  }

  return index;
};

const mergeIndexedMessagesByDescendingIndex = (
  left: readonly IndexedCurrentMessage[],
  right: readonly IndexedCurrentMessage[],
): IndexedCurrentMessage[] => {
  if (left.length === 0) {
    return right.length === 0 ? [] : [...right];
  }
  if (right.length === 0) {
    return [...left];
  }

  const merged: IndexedCurrentMessage[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftEntry = left[leftIndex];
    const rightEntry = right[rightIndex];
    if (!leftEntry) {
      leftIndex += 1;
      continue;
    }
    if (!rightEntry) {
      rightIndex += 1;
      continue;
    }
    if (leftEntry.index >= rightEntry.index) {
      merged.push(leftEntry);
      leftIndex += 1;
    } else {
      merged.push(rightEntry);
      rightIndex += 1;
    }
  }
  for (; leftIndex < left.length; leftIndex += 1) {
    const entry = left[leftIndex];
    if (entry) {
      merged.push(entry);
    }
  }
  for (; rightIndex < right.length; rightIndex += 1) {
    const entry = right[rightIndex];
    if (entry) {
      merged.push(entry);
    }
  }
  return merged;
};

/**
 * Match the live row by source message id: a live assistant row can be keyed by a text
 * part id, while the hydrated whole-message row uses the runtime message id. Loaded part
 * rows carry their own part id, so this lookup skips them.
 */
const findCurrentAssistantMessagesForLoadedHistory = ({
  currentIndex,
  loadedMessage,
  absorbedCurrentMessageIds,
}: {
  currentIndex: CurrentMessageIndex;
  loadedMessage: AgentChatMessage;
  absorbedCurrentMessageIds: ReadonlySet<string>;
}): AgentChatMessage[] => {
  if (loadedMessage.role !== "assistant" || loadedMessage.meta?.kind !== "assistant") {
    return [];
  }
  if (loadedMessage.meta.partId !== undefined) {
    return [];
  }

  const candidates = currentIndex.assistantMessagesBySourceMessageId.get(loadedMessage.id) ?? [];
  for (const candidate of candidates) {
    if (!absorbedCurrentMessageIds.has(candidate.message.id)) {
      return [candidate.message];
    }
  }
  return [];
};

const findMatchingCurrentToolMessages = ({
  currentIndex,
  loadedMessage,
  sameIdCurrentMessage,
  absorbedCurrentMessageIds,
}: {
  currentIndex: CurrentMessageIndex;
  loadedMessage: AgentChatMessage;
  sameIdCurrentMessage: AgentChatMessage | undefined;
  absorbedCurrentMessageIds: ReadonlySet<string>;
}): AgentChatMessage[] => {
  const matches = sameIdCurrentMessageOrEmpty(sameIdCurrentMessage, absorbedCurrentMessageIds);
  const seenIds = new Set(matches.map((message) => message.id));
  const keys = toolMessageMatchKeys(loadedMessage);
  if (keys === null) {
    return matches;
  }
  const candidates = mergeIndexedMessagesByDescendingIndex(
    keys.callId.length > 0 ? (currentIndex.toolMessagesByCallId.get(keys.callId) ?? []) : [],
    keys.partKey !== null ? (currentIndex.toolMessagesByPartKey.get(keys.partKey) ?? []) : [],
  );
  for (const candidate of candidates) {
    if (seenIds.has(candidate.message.id) || absorbedCurrentMessageIds.has(candidate.message.id)) {
      continue;
    }
    if (matchesLoadedTool(loadedMessage, candidate.message)) {
      matches.push(candidate.message);
      seenIds.add(candidate.message.id);
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

const confirmsLocalAcceptedUserMessage = (
  loadedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage,
): number | null => {
  if (
    !isUserMessage(loadedMessage) ||
    !isUserMessage(currentMessage) ||
    loadedMessage.meta.state !== "read" ||
    currentMessage.meta.state !== "read" ||
    loadedMessage.content !== currentMessage.content ||
    !haveSameUserMessageAttachmentIdentity(loadedMessage, currentMessage)
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
  currentIndex,
  loadedMessage,
  sameIdCurrentMessage,
  absorbedCurrentMessageIds,
}: {
  currentIndex: CurrentMessageIndex;
  loadedMessage: AgentChatMessage;
  sameIdCurrentMessage: AgentChatMessage | undefined;
  absorbedCurrentMessageIds: ReadonlySet<string>;
}): AgentChatMessage[] => {
  const matches = sameIdCurrentMessageOrEmpty(sameIdCurrentMessage, absorbedCurrentMessageIds);
  if (matches.length > 0) {
    return matches;
  }

  const matchKey = userMessageMatchKey(loadedMessage);
  if (matchKey === null) {
    return [];
  }
  const candidates = currentIndex.readUserMessagesByMatchKey.get(matchKey) ?? [];
  type NearestMessageMatch = { message: AgentChatMessage; distanceMs: number };
  let nearestMatch: NearestMessageMatch | null = null;
  for (const candidate of candidates) {
    if (absorbedCurrentMessageIds.has(candidate.message.id)) {
      continue;
    }
    const distanceMs = confirmsLocalAcceptedUserMessage(loadedMessage, candidate.message);
    if (distanceMs === null) {
      continue;
    }
    if (!nearestMatch || distanceMs < nearestMatch.distanceMs) {
      nearestMatch = { message: candidate.message, distanceMs };
    }
  }

  if (nearestMatch) {
    return [nearestMatch.message];
  }

  return [];
};

const findMatchingCurrentMessages = ({
  currentIndex,
  loadedMessage,
  sameIdCurrentMessage,
  absorbedCurrentMessageIds,
}: {
  currentIndex: CurrentMessageIndex;
  loadedMessage: AgentChatMessage;
  sameIdCurrentMessage: AgentChatMessage | undefined;
  absorbedCurrentMessageIds: ReadonlySet<string>;
}): AgentChatMessage[] => {
  if (isSubagentMessage(loadedMessage)) {
    return findCurrentSubagentMessagesForLoadedHistory({
      currentOwner: currentIndex.owner,
      loadedMessage,
      sameIdCurrentMessage,
      absorbedCurrentMessageIds,
    });
  }

  if (isUserMessage(loadedMessage)) {
    return findConfirmedLocalAcceptedUserMessage({
      currentIndex,
      loadedMessage,
      sameIdCurrentMessage,
      absorbedCurrentMessageIds,
    });
  }

  if (loadedMessage.meta?.kind === "tool") {
    return findMatchingCurrentToolMessages({
      currentIndex,
      loadedMessage,
      sameIdCurrentMessage,
      absorbedCurrentMessageIds,
    });
  }

  const sameIdMatches = sameIdCurrentMessageOrEmpty(
    sameIdCurrentMessage,
    absorbedCurrentMessageIds,
  );
  if (sameIdMatches.length > 0) {
    return sameIdMatches;
  }
  return findCurrentAssistantMessagesForLoadedHistory({
    currentIndex,
    loadedMessage,
    absorbedCurrentMessageIds,
  });
};

const mergeSameMessageId = (
  loadedMessage: AgentChatMessage,
  currentMessage: AgentChatMessage | undefined,
  messagesAtReadStart?: AgentSessionState["messages"],
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
    const meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "user" }> = {
      ...currentMessage.meta,
      ...loadedMessage.meta,
    };
    if (parts) {
      meta.parts = parts;
    }
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

  if (
    loadedMessage.meta?.kind === "image_generation" &&
    currentMessage.meta?.kind === "image_generation"
  ) {
    const beforeRead = messagesAtReadStart?.items.find(
      (message) => message.id === currentMessage.id,
    )?.meta;
    return {
      ...currentMessage,
      meta: mergeAgentImageGeneration(
        currentMessage.meta,
        loadedMessage.meta,
        "history",
        beforeRead?.kind === "image_generation" ? beforeRead : undefined,
      ),
    };
  }

  if (isFinalAssistantChatMessage(loadedMessage) && currentMessage.role === "assistant") {
    const mergedMeta =
      currentMessage.meta && loadedMessage.meta
        ? { ...currentMessage.meta, ...loadedMessage.meta }
        : (loadedMessage.meta ?? currentMessage.meta);
    const mergedMessage: AgentChatMessage = { ...currentMessage, ...loadedMessage };
    if (mergedMeta) {
      mergedMessage.meta = mergedMeta;
    }
    return applyPreferredMessageTimestamp(mergedMessage, loadedMessage, currentMessage);
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
  messagesAtReadStart?: AgentSessionState["messages"],
): AgentSessionState["messages"] => {
  const currentOwner = { externalSessionId, messages: currentMessages };
  const loadedOwner = { externalSessionId, messages: loadedMessages };
  const currentIndex = buildCurrentMessageIndex(currentOwner);
  const loadedHasSystemPrompt = someSessionMessage(loadedOwner, isSessionSystemPromptMessage);
  const loadedMessageIds = new Set<string>();
  const absorbedCurrentMessageIds = new Set<string>();
  const mergedMessages: AgentChatMessage[] = [];
  const mergedTimestampsMs: (number | null)[] = [];
  let minimumInsertionIndex = 0;

  const pushMergedMessage = (message: AgentChatMessage): void => {
    mergedMessages.push(message);
    mergedTimestampsMs.push(messageTimestampMs(message));
    if (isSessionSystemPromptMessage(message)) {
      minimumInsertionIndex = mergedMessages.length;
    }
  };

  if (!loadedHasSystemPrompt) {
    forEachSessionMessage(currentOwner, (message) => {
      if (!isSessionSystemPromptMessage(message)) {
        return;
      }
      absorbedCurrentMessageIds.add(message.id);
      pushMergedMessage(message);
    });
  }

  forEachSessionMessage(loadedOwner, (message) => {
    const sameIdCurrentMessage = currentIndex.firstById.get(message.id);
    const matchingCurrentMessages = findMatchingCurrentMessages({
      currentIndex,
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
        mergeSameMessageId(currentMerged, matchingCurrentMessage, messagesAtReadStart),
      message,
    );
    pushMergedMessage(mergedMessage);
  });

  forEachSessionMessage(currentOwner, (message) => {
    if (loadedMessageIds.has(message.id) || absorbedCurrentMessageIds.has(message.id)) {
      return;
    }
    if (isSessionSystemPromptMessage(message)) {
      return;
    }
    const incomingMs = messageTimestampMs(message);
    if (incomingMs === null) {
      pushMergedMessage(message);
      return;
    }
    const insertIndex = sessionMessageTimestampInsertionIndex(mergedMessages, message, {
      timestampsMs: mergedTimestampsMs,
      minimumInsertionIndex,
    });
    mergedMessages.splice(insertIndex, 0, message);
    mergedTimestampsMs.splice(insertIndex, 0, incomingMs);
  });

  return createSessionMessagesState(externalSessionId, mergedMessages, currentMessages.version + 1);
};
