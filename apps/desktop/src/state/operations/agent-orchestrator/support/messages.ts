import type {
  AgentChatMessage,
  AgentSessionMessages,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";

type MessageRole = AgentChatMessage["role"];
type MessageRoleIndexCache = Partial<Record<MessageRole, number[]>>;
type MessageLastIndexCache = Partial<Record<MessageRole, number>>;

export type SessionMessageOwner = Pick<AgentSessionState, "sessionId" | "messages">;

const SESSION_MESSAGES_DATA = Symbol("sessionMessagesData");
const SESSION_MESSAGES_BY_ID = Symbol("sessionMessagesById");
const SESSION_MESSAGES_INDEXES_BY_ROLE = Symbol("sessionMessagesIndexesByRole");
const SESSION_MESSAGES_LAST_INDEX_BY_ROLE = Symbol("sessionMessagesLastIndexByRole");

type InternalSessionMessagesState = SessionMessagesState & {
  [SESSION_MESSAGES_DATA]: AgentChatMessage[];
  [SESSION_MESSAGES_BY_ID]?: Map<string, number>;
  [SESSION_MESSAGES_INDEXES_BY_ROLE]?: MessageRoleIndexCache;
  [SESSION_MESSAGES_LAST_INDEX_BY_ROLE]?: MessageLastIndexCache;
};

const hasCachedRole = (
  cache: MessageRoleIndexCache | MessageLastIndexCache | undefined,
  role: MessageRole,
): boolean => {
  return cache !== undefined && Object.hasOwn(cache, role);
};

const isSessionMessagesState = (
  messages: AgentSessionMessages,
): messages is SessionMessagesState => {
  return typeof messages === "object" && messages !== null && SESSION_MESSAGES_DATA in messages;
};

const toInternalState = (state: SessionMessagesState): InternalSessionMessagesState => {
  return state as InternalSessionMessagesState;
};

const createInternalState = (
  sessionId: string,
  messages: AgentChatMessage[],
  version: number,
  byId?: Map<string, number>,
  indexesByRole?: MessageRoleIndexCache,
  lastIndexByRole?: MessageLastIndexCache,
): SessionMessagesState => {
  const state = {
    sessionId,
    count: messages.length,
    version,
    [SESSION_MESSAGES_DATA]: messages,
    ...(byId ? { [SESSION_MESSAGES_BY_ID]: byId } : {}),
    ...(indexesByRole ? { [SESSION_MESSAGES_INDEXES_BY_ROLE]: indexesByRole } : {}),
    ...(lastIndexByRole ? { [SESSION_MESSAGES_LAST_INDEX_BY_ROLE]: lastIndexByRole } : {}),
  } satisfies InternalSessionMessagesState;

  return state;
};

const getSessionState = (owner: SessionMessageOwner): InternalSessionMessagesState => {
  if (isSessionMessagesState(owner.messages)) {
    const state = toInternalState(owner.messages);
    if (state.sessionId === owner.sessionId) {
      return state;
    }
    return toInternalState(
      createSessionMessagesState(owner.sessionId, state[SESSION_MESSAGES_DATA]),
    );
  }

  return toInternalState(createSessionMessagesState(owner.sessionId, owner.messages));
};

const buildIdIndex = (messages: AgentChatMessage[]): Map<string, number> => {
  const byId = new Map<string, number>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message) {
      byId.set(message.id, index);
    }
  }
  return byId;
};

const buildRoleIndexes = (messages: AgentChatMessage[], role: MessageRole): number[] => {
  const indexes: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === role) {
      indexes.push(index);
    }
  }
  return indexes;
};

const buildLastRoleIndex = (messages: AgentChatMessage[], role: MessageRole): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) {
      return index;
    }
  }
  return -1;
};

const getMessageData = (owner: SessionMessageOwner): AgentChatMessage[] => {
  return getSessionState(owner)[SESSION_MESSAGES_DATA];
};

const getMessageIndexById = (owner: SessionMessageOwner): Map<string, number> => {
  const state = getSessionState(owner);
  if (state[SESSION_MESSAGES_BY_ID]) {
    return state[SESSION_MESSAGES_BY_ID];
  }

  const built = buildIdIndex(state[SESSION_MESSAGES_DATA]);
  state[SESSION_MESSAGES_BY_ID] = built;
  return built;
};

const getMessageIndexesByRole = (owner: SessionMessageOwner, role: MessageRole): number[] => {
  const state = getSessionState(owner);
  if (hasCachedRole(state[SESSION_MESSAGES_INDEXES_BY_ROLE], role)) {
    return state[SESSION_MESSAGES_INDEXES_BY_ROLE]?.[role] ?? [];
  }

  const built = buildRoleIndexes(state[SESSION_MESSAGES_DATA], role);
  if (!state[SESSION_MESSAGES_INDEXES_BY_ROLE]) {
    state[SESSION_MESSAGES_INDEXES_BY_ROLE] = {};
  }
  state[SESSION_MESSAGES_INDEXES_BY_ROLE][role] = built;
  return built;
};

const getLastMessageIndexByRole = (owner: SessionMessageOwner, role: MessageRole): number => {
  const state = getSessionState(owner);
  if (hasCachedRole(state[SESSION_MESSAGES_LAST_INDEX_BY_ROLE], role)) {
    return state[SESSION_MESSAGES_LAST_INDEX_BY_ROLE]?.[role] ?? -1;
  }

  const built = buildLastRoleIndex(state[SESSION_MESSAGES_DATA], role);
  if (!state[SESSION_MESSAGES_LAST_INDEX_BY_ROLE]) {
    state[SESSION_MESSAGES_LAST_INDEX_BY_ROLE] = {};
  }
  state[SESSION_MESSAGES_LAST_INDEX_BY_ROLE][role] = built;
  return built;
};

const areMessagesShallowEqual = (left: AgentChatMessage, right: AgentChatMessage): boolean => {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.content === right.content &&
    left.timestamp === right.timestamp &&
    left.meta === right.meta
  );
};

const createDerivedState = (
  previous: InternalSessionMessagesState,
  messages: AgentChatMessage[],
  byId?: Map<string, number>,
  indexesByRole?: MessageRoleIndexCache,
  lastIndexByRole?: MessageLastIndexCache,
): SessionMessagesState => {
  return createInternalState(
    previous.sessionId,
    messages,
    previous.version + 1,
    byId,
    indexesByRole,
    lastIndexByRole,
  );
};

const deriveStateForAppend = (
  previous: InternalSessionMessagesState,
  message: AgentChatMessage,
  nextMessages: AgentChatMessage[],
): SessionMessagesState => {
  const nextIndex = nextMessages.length - 1;
  const byId = previous[SESSION_MESSAGES_BY_ID]
    ? new Map(previous[SESSION_MESSAGES_BY_ID]).set(message.id, nextIndex)
    : undefined;
  const indexesByRole = previous[SESSION_MESSAGES_INDEXES_BY_ROLE]
    ? {
        ...previous[SESSION_MESSAGES_INDEXES_BY_ROLE],
        ...(hasCachedRole(previous[SESSION_MESSAGES_INDEXES_BY_ROLE], message.role)
          ? {
              [message.role]: [
                ...(previous[SESSION_MESSAGES_INDEXES_BY_ROLE]?.[message.role] ?? []),
                nextIndex,
              ],
            }
          : {}),
      }
    : undefined;
  const lastIndexByRole = previous[SESSION_MESSAGES_LAST_INDEX_BY_ROLE]
    ? {
        ...previous[SESSION_MESSAGES_LAST_INDEX_BY_ROLE],
        [message.role]: nextIndex,
      }
    : undefined;

  return createDerivedState(previous, nextMessages, byId, indexesByRole, lastIndexByRole);
};

const deriveStateForSingleUpdate = (
  previous: InternalSessionMessagesState,
  index: number,
  existing: AgentChatMessage,
  updated: AgentChatMessage,
  nextMessages: AgentChatMessage[],
): SessionMessagesState => {
  const roleChanged = updated.role !== existing.role;
  const idChanged = updated.id !== existing.id;
  const previousById = previous[SESSION_MESSAGES_BY_ID];
  const byId = previousById
    ? (() => {
        if (!idChanged) {
          return previousById;
        }
        const nextById = new Map(previousById);
        nextById.delete(existing.id);
        nextById.set(updated.id, index);
        return nextById;
      })()
    : undefined;

  return createDerivedState(
    previous,
    nextMessages,
    byId,
    roleChanged ? undefined : previous[SESSION_MESSAGES_INDEXES_BY_ROLE],
    roleChanged ? undefined : previous[SESSION_MESSAGES_LAST_INDEX_BY_ROLE],
  );
};

const deriveStateForRoleBatchUpdate = (
  previous: InternalSessionMessagesState,
  nextMessages: AgentChatMessage[],
  nextIndexById: Map<string, number> | null,
  changedRole: boolean,
): SessionMessagesState => {
  return createDerivedState(
    previous,
    nextMessages,
    previous[SESSION_MESSAGES_BY_ID]
      ? (nextIndexById ?? previous[SESSION_MESSAGES_BY_ID])
      : undefined,
    changedRole ? undefined : previous[SESSION_MESSAGES_INDEXES_BY_ROLE],
    changedRole ? undefined : previous[SESSION_MESSAGES_LAST_INDEX_BY_ROLE],
  );
};

const findMessageIndexById = (owner: SessionMessageOwner, messageId: string): number => {
  return getMessageIndexById(owner).get(messageId) ?? -1;
};

const findLastMessageIndexByRole = (
  owner: SessionMessageOwner,
  role: MessageRole,
  predicate?: (message: AgentChatMessage, index: number) => boolean,
): number => {
  if (!predicate) {
    return getLastMessageIndexByRole(owner, role);
  }

  const indexes = getMessageIndexesByRole(owner, role);
  const messages = getMessageData(owner);
  for (let offset = indexes.length - 1; offset >= 0; offset -= 1) {
    const index = indexes[offset];
    if (typeof index !== "number") {
      continue;
    }
    const message = messages[index];
    if (message && predicate(message, index)) {
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
  const existing = previous[SESSION_MESSAGES_DATA][index];
  if (!existing) {
    return previous;
  }

  const updated = updater(existing);
  if (updated === existing || areMessagesShallowEqual(existing, updated)) {
    return previous;
  }

  const nextMessages = previous[SESSION_MESSAGES_DATA].slice();
  nextMessages[index] = updated;
  return deriveStateForSingleUpdate(previous, index, existing, updated, nextMessages);
};

export const createSessionMessagesState = (
  sessionId: string,
  messages: readonly AgentChatMessage[] = [],
): SessionMessagesState => {
  return createInternalState(sessionId, [...messages], 0);
};

export const getSessionMessageCount = (owner: SessionMessageOwner): number => {
  return getSessionState(owner).count;
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

export const appendSessionMessage = (
  owner: SessionMessageOwner,
  message: AgentChatMessage,
): SessionMessagesState => {
  const previous = getSessionState(owner);
  const nextMessages = [...previous[SESSION_MESSAGES_DATA], message];
  return deriveStateForAppend(previous, message, nextMessages);
};

export const updateSessionMessageById = (
  owner: SessionMessageOwner,
  messageId: string,
  updater: (message: AgentChatMessage) => AgentChatMessage,
): SessionMessagesState => {
  const index = findMessageIndexById(owner, messageId);
  return index >= 0 ? updateMessageAtIndex(owner, index, updater) : getSessionState(owner);
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

  const nextMessages = previous[SESSION_MESSAGES_DATA].slice();
  nextMessages.splice(index, 1);
  return createDerivedState(previous, nextMessages);
};

export const updateLastSessionMessage = (
  owner: SessionMessageOwner,
  updater: (message: AgentChatMessage) => AgentChatMessage,
): SessionMessagesState => {
  const lastIndex = getSessionState(owner).count - 1;
  return lastIndex >= 0 ? updateMessageAtIndex(owner, lastIndex, updater) : getSessionState(owner);
};

export const updateLastSessionMessageByRole = (
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
  const indexes = getMessageIndexesByRole(owner, role);
  let nextMessages: AgentChatMessage[] | null = null;
  let changedRole = false;
  let nextIndexById: Map<string, number> | null = null;
  const currentIndexById = previous[SESSION_MESSAGES_BY_ID];

  for (const index of indexes) {
    const source = nextMessages ?? previous[SESSION_MESSAGES_DATA];
    const existing = source[index];
    if (!existing) {
      continue;
    }

    const updated = updater(existing, index);
    if (updated === existing || areMessagesShallowEqual(existing, updated)) {
      continue;
    }

    if (!nextMessages) {
      nextMessages = previous[SESSION_MESSAGES_DATA].slice();
    }
    nextMessages[index] = updated;
    changedRole ||= updated.role !== existing.role;

    if (currentIndexById && updated.id !== existing.id) {
      if (!nextIndexById) {
        nextIndexById = new Map(currentIndexById);
      }
      nextIndexById.delete(existing.id);
      nextIndexById.set(updated.id, index);
    }
  }

  if (!nextMessages) {
    return previous;
  }

  return deriveStateForRoleBatchUpdate(previous, nextMessages, nextIndexById, changedRole);
};

export const upsertSessionMessage = (
  owner: SessionMessageOwner,
  message: AgentChatMessage,
): SessionMessagesState => {
  const previous = getSessionState(owner);
  const lastIndex = previous.count - 1;
  if (lastIndex >= 0 && previous[SESSION_MESSAGES_DATA][lastIndex]?.id === message.id) {
    return mergeAtIndex(previous, lastIndex, message);
  }

  const index =
    previous[SESSION_MESSAGES_BY_ID]?.get(message.id) ?? findMessageIndexById(owner, message.id);
  if (index < 0) {
    const nextMessages = [...previous[SESSION_MESSAGES_DATA], message];
    return deriveStateForAppend(previous, message, nextMessages);
  }

  return mergeAtIndex(previous, index, message);
};

export const findFirstChangedSessionMessageIndex = (
  previousMessages: AgentSessionMessages | null,
  nextOwner: SessionMessageOwner,
): number => {
  if (previousMessages === null) {
    return 0;
  }

  const previous = isSessionMessagesState(previousMessages)
    ? toInternalState(previousMessages)
    : toInternalState(createSessionMessagesState(nextOwner.sessionId, previousMessages));
  const next = getSessionState(nextOwner);
  if (previous === next) {
    return -1;
  }

  const previousData = previous[SESSION_MESSAGES_DATA];
  const nextData = next[SESSION_MESSAGES_DATA];
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
  previous: InternalSessionMessagesState,
  index: number,
  incoming: AgentChatMessage,
): SessionMessagesState {
  const existing = previous[SESSION_MESSAGES_DATA][index];
  if (!existing) {
    return previous;
  }

  const merged = { ...existing, ...incoming };
  if (areMessagesShallowEqual(existing, merged)) {
    return previous;
  }

  const nextMessages = previous[SESSION_MESSAGES_DATA].slice();
  nextMessages[index] = merged;
  return deriveStateForSingleUpdate(previous, index, existing, merged, nextMessages);
}
