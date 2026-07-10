import type { AgentChatMessage, SessionMessagesState } from "@/types/agent-orchestrator";
import { applyMessageTimestamp, haveSameMessageTimestamp } from "./message-timestamp";

type MessageRole = AgentChatMessage["role"];

export type SessionMessageOwner = {
  externalSessionId: string;
  messages: SessionMessagesState;
};

export type SessionMessagesRevision = {
  externalSessionId: string;
  count: number;
  version: number;
};

const areMessagesShallowEqual = (left: AgentChatMessage, right: AgentChatMessage): boolean => {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.content === right.content &&
    haveSameMessageTimestamp(left, right) &&
    left.meta === right.meta
  );
};

const getSessionState = (owner: SessionMessageOwner): SessionMessagesState => {
  if (owner.messages.externalSessionId === owner.externalSessionId) {
    return owner.messages;
  }

  throw new Error(
    `Session messages for '${owner.externalSessionId}' belong to '${owner.messages.externalSessionId}'.`,
  );
};

const getMessageData = (owner: SessionMessageOwner): readonly AgentChatMessage[] => {
  return getSessionState(owner).items;
};

const createDerivedState = (
  previous: SessionMessagesState,
  messages: readonly AgentChatMessage[],
): SessionMessagesState => {
  return createSessionMessagesState(previous.externalSessionId, messages, previous.version + 1);
};

const findMessageIndexById = (owner: SessionMessageOwner, messageId: string): number => {
  const messages = getMessageData(owner);
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.id === messageId) {
      return index;
    }
  }

  return -1;
};

const findLastMessageIndexByRole = (
  owner: SessionMessageOwner,
  role: MessageRole,
  predicate?: (message: AgentChatMessage, index: number) => boolean,
): number => {
  const messages = getMessageData(owner);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== role) {
      continue;
    }
    if (!predicate || predicate(message, index)) {
      return index;
    }
  }

  return -1;
};

const updateMessageAtIndex = (
  owner: SessionMessageOwner,
  index: number,
  updater: (message: AgentChatMessage) => AgentChatMessage,
): SessionMessagesState => {
  const previous = getSessionState(owner);
  const existing = previous.items[index];
  if (!existing) {
    return previous;
  }

  const updated = updater(existing);
  if (updated === existing || areMessagesShallowEqual(existing, updated)) {
    return previous;
  }

  const nextMessages = previous.items.slice();
  nextMessages[index] = updated;
  return createDerivedState(previous, nextMessages);
};

const CODEX_SYNTHETIC_USER_MESSAGE_CONFIRMATION_WINDOW_MS = 10_000;

const isCodexSyntheticUserMessageId = (messageId: string): boolean =>
  messageId.startsWith("codex-user-");

const timestampMs = (timestamp: string): number | null => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
};

const confirmsCodexSyntheticUserMessage = (
  existing: AgentChatMessage,
  incoming: AgentChatMessage & { role: "user" },
): boolean => {
  if (
    existing.role !== "user" ||
    existing.content !== incoming.content ||
    !isCodexSyntheticUserMessageId(existing.id) ||
    isCodexSyntheticUserMessageId(incoming.id)
  ) {
    return false;
  }

  const existingTimestampMs = timestampMs(existing.timestamp);
  const incomingTimestampMs = timestampMs(incoming.timestamp);
  if (existingTimestampMs === null || incomingTimestampMs === null) {
    return false;
  }

  return (
    Math.abs(existingTimestampMs - incomingTimestampMs) <=
    CODEX_SYNTHETIC_USER_MESSAGE_CONFIRMATION_WINDOW_MS
  );
};

export const createSessionMessagesState = (
  externalSessionId: string,
  messages: readonly AgentChatMessage[] = [],
  version = 0,
): SessionMessagesState => {
  return {
    externalSessionId,
    items: [...messages],
    version,
  };
};

export const toSessionMessagesState = (owner: SessionMessageOwner): SessionMessagesState => {
  return getSessionState(owner);
};

export const getSessionMessagesRevision = (owner: SessionMessageOwner): SessionMessagesRevision => {
  const state = getSessionState(owner);
  return {
    externalSessionId: state.externalSessionId,
    count: state.items.length,
    version: state.version,
  };
};

export const areSessionMessagesSameRevision = (
  leftOwner: SessionMessageOwner,
  rightOwner: SessionMessageOwner,
): boolean => {
  if (leftOwner.messages === rightOwner.messages) {
    return true;
  }

  const left = getSessionMessagesRevision(leftOwner);
  const right = getSessionMessagesRevision(rightOwner);
  return (
    left.externalSessionId === right.externalSessionId &&
    left.count === right.count &&
    left.version === right.version
  );
};

export const getSessionMessageCount = (owner: SessionMessageOwner): number => {
  return getSessionState(owner).items.length;
};

export const getSessionMessageAt = (
  owner: SessionMessageOwner,
  index: number,
): AgentChatMessage | undefined => {
  return getMessageData(owner)[index];
};

export const getSessionMessagesSlice = (
  owner: SessionMessageOwner,
  start: number,
  end?: number,
): AgentChatMessage[] => {
  return getMessageData(owner).slice(start, end);
};

export const forEachSessionMessage = (
  owner: SessionMessageOwner,
  visitor: (message: AgentChatMessage, index: number) => void,
): void => {
  const messages = getMessageData(owner);
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message) {
      visitor(message, index);
    }
  }
};

export const forEachSessionMessageFrom = (
  owner: SessionMessageOwner,
  startIndex: number,
  visitor: (message: AgentChatMessage, index: number) => void,
): void => {
  const messages = getMessageData(owner);
  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (message) {
      visitor(message, index);
    }
  }
};

export const someSessionMessage = (
  owner: SessionMessageOwner,
  predicate: (message: AgentChatMessage, index: number) => boolean,
): boolean => {
  const messages = getMessageData(owner);
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message && predicate(message, index)) {
      return true;
    }
  }
  return false;
};

export const everySessionMessage = (
  owner: SessionMessageOwner,
  predicate: (message: AgentChatMessage, index: number) => boolean,
): boolean => {
  const messages = getMessageData(owner);
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message && !predicate(message, index)) {
      return false;
    }
  }
  return true;
};

export const findSessionMessageById = (
  owner: SessionMessageOwner,
  messageId: string,
): AgentChatMessage | undefined => {
  const index = findMessageIndexById(owner, messageId);
  return index >= 0 ? getMessageData(owner)[index] : undefined;
};

export const findLastSessionMessage = (
  owner: SessionMessageOwner,
): AgentChatMessage | undefined => {
  const messages = getMessageData(owner);
  return messages.length > 0 ? messages[messages.length - 1] : undefined;
};

export const findLastSessionMessageByRole = (
  owner: SessionMessageOwner,
  role: MessageRole,
  predicate?: (message: AgentChatMessage, index: number) => boolean,
): AgentChatMessage | undefined => {
  const index = findLastMessageIndexByRole(owner, role, predicate);
  return index >= 0 ? getMessageData(owner)[index] : undefined;
};

export const findLastUserSessionMessage = (
  owner: SessionMessageOwner,
): AgentChatMessage | undefined => {
  return findLastSessionMessageByRole(owner, "user");
};

export const findLastToolSessionMessage = (
  owner: SessionMessageOwner,
  predicate?: (message: AgentChatMessage, index: number) => boolean,
): AgentChatMessage | undefined => {
  return findLastSessionMessageByRole(owner, "tool", predicate);
};

export const isFinalAssistantChatMessage = (
  message: AgentChatMessage | undefined | null,
): message is AgentChatMessage & {
  role: "assistant";
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }> & {
    isFinal: true;
  };
} => {
  return (
    message?.role === "assistant" &&
    message.meta?.kind === "assistant" &&
    message.meta.isFinal === true
  );
};

export const appendSessionMessage = (
  owner: SessionMessageOwner,
  message: AgentChatMessage,
): SessionMessagesState => {
  const previous = getSessionState(owner);
  return createDerivedState(previous, [...previous.items, message]);
};

export const removeSessionMessageById = (
  owner: SessionMessageOwner,
  messageId: string,
): SessionMessagesState => {
  const previous = getSessionState(owner);
  const index = findMessageIndexById(owner, messageId);
  if (index < 0) {
    return previous;
  }

  const nextMessages = previous.items.slice();
  nextMessages.splice(index, 1);
  return createDerivedState(previous, nextMessages);
};

export const updateLastSessionMessage = (
  owner: SessionMessageOwner,
  updater: (message: AgentChatMessage) => AgentChatMessage,
): SessionMessagesState => {
  const lastIndex = getSessionMessageCount(owner) - 1;
  return lastIndex >= 0 ? updateMessageAtIndex(owner, lastIndex, updater) : getSessionState(owner);
};

const updateLastSessionMessageByRole = (
  owner: SessionMessageOwner,
  role: MessageRole,
  predicate: (message: AgentChatMessage, index: number) => boolean,
  updater: (message: AgentChatMessage) => AgentChatMessage,
): SessionMessagesState => {
  const index = findLastMessageIndexByRole(owner, role, predicate);
  return index >= 0 ? updateMessageAtIndex(owner, index, updater) : getSessionState(owner);
};

export const updateLastToolSessionMessage = (
  owner: SessionMessageOwner,
  predicate: (message: AgentChatMessage, index: number) => boolean,
  updater: (message: AgentChatMessage) => AgentChatMessage,
): SessionMessagesState => {
  return updateLastSessionMessageByRole(owner, "tool", predicate, updater);
};

export const updateSessionMessagesByRole = (
  owner: SessionMessageOwner,
  role: MessageRole,
  updater: (message: AgentChatMessage, index: number) => AgentChatMessage,
): SessionMessagesState => {
  const previous = getSessionState(owner);
  let nextMessages: AgentChatMessage[] | null = null;

  for (let index = 0; index < previous.items.length; index += 1) {
    const existing = previous.items[index];
    if (!existing || existing.role !== role) {
      continue;
    }

    const updated = updater(existing, index);
    if (updated === existing || areMessagesShallowEqual(existing, updated)) {
      continue;
    }

    if (!nextMessages) {
      nextMessages = previous.items.slice();
    }
    nextMessages[index] = updated;
  }

  return nextMessages ? createDerivedState(previous, nextMessages) : previous;
};

export const upsertSessionMessage = (
  owner: SessionMessageOwner,
  message: AgentChatMessage,
): SessionMessagesState => {
  const previous = getSessionState(owner);
  const lastIndex = previous.items.length - 1;
  if (lastIndex >= 0 && previous.items[lastIndex]?.id === message.id) {
    return mergeAtIndex(previous, lastIndex, message);
  }

  const index = findMessageIndexById(owner, message.id);
  if (index < 0) {
    return createDerivedState(previous, [...previous.items, message]);
  }

  return mergeAtIndex(previous, index, message);
};

export const upsertUserSessionMessage = (
  owner: SessionMessageOwner,
  message: AgentChatMessage & { role: "user" },
): SessionMessagesState => {
  const previous = getSessionState(owner);
  const idIndex = findMessageIndexById(owner, message.id);
  if (idIndex >= 0) {
    return mergeAtIndex(previous, idIndex, message);
  }

  const equivalentIndex = findLastMessageIndexByRole(
    owner,
    "user",
    (existing) =>
      (existing.content === message.content && existing.timestamp === message.timestamp) ||
      confirmsCodexSyntheticUserMessage(existing, message),
  );
  if (equivalentIndex >= 0) {
    return mergeAtIndex(previous, equivalentIndex, message);
  }

  return createDerivedState(previous, [...previous.items, message]);
};

const insertSessionMessageByTimestamp = (
  previous: SessionMessagesState,
  message: AgentChatMessage,
): SessionMessagesState => {
  const incomingMs = timestampMs(message.timestamp);
  if (incomingMs === null) {
    return createDerivedState(previous, [...previous.items, message]);
  }

  const insertionIndex = previous.items.findIndex((existing) => {
    const existingMs = timestampMs(existing.timestamp);
    return existingMs !== null && existingMs > incomingMs;
  });

  if (insertionIndex < 0) {
    return createDerivedState(previous, [...previous.items, message]);
  }

  const nextMessages = previous.items.slice();
  nextMessages.splice(insertionIndex, 0, message);
  return createDerivedState(previous, nextMessages);
};

export const upsertSessionMessageByTimestamp = (
  owner: SessionMessageOwner,
  message: AgentChatMessage,
): SessionMessagesState => {
  const previous = getSessionState(owner);
  const index = findMessageIndexById(owner, message.id);
  if (index >= 0) {
    return mergeAtIndex(previous, index, message);
  }

  return insertSessionMessageByTimestamp(previous, message);
};

export const findFirstChangedSessionMessageIndex = (
  previousMessages: SessionMessagesState | null,
  nextOwner: SessionMessageOwner,
): number => {
  if (previousMessages === null) {
    return 0;
  }

  const next = getSessionState(nextOwner);
  if (previousMessages.externalSessionId !== next.externalSessionId) {
    return 0;
  }
  if (previousMessages === next) {
    return -1;
  }

  const previousData = previousMessages.items;
  const nextData = next.items;
  if (nextData.length < previousData.length) {
    return 0;
  }

  const sharedLength = Math.min(previousData.length, nextData.length);
  let changedTailIndex = sharedLength - 1;
  while (changedTailIndex >= 0) {
    if (previousData[changedTailIndex] !== nextData[changedTailIndex]) {
      break;
    }
    changedTailIndex -= 1;
  }

  if (changedTailIndex >= 0) {
    while (changedTailIndex > 0) {
      if (previousData[changedTailIndex - 1] === nextData[changedTailIndex - 1]) {
        break;
      }
      changedTailIndex -= 1;
    }
    return changedTailIndex;
  }

  return nextData.length > previousData.length ? previousData.length : -1;
};

function mergeAtIndex(
  previous: SessionMessagesState,
  index: number,
  incoming: AgentChatMessage,
): SessionMessagesState {
  const existing = previous.items[index];
  if (!existing) {
    return previous;
  }

  const merged = applyMessageTimestamp({ ...existing, ...incoming }, incoming);
  if (areMessagesShallowEqual(existing, merged)) {
    return previous;
  }

  const nextMessages = previous.items.slice();
  nextMessages[index] = merged;
  return createDerivedState(previous, nextMessages);
}
