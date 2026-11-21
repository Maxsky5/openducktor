import {
  createSessionMessagesState,
  getSessionMessageAt,
  getSessionMessageCount,
  forEachSessionMessage,
  type SessionMessageOwner,
} from "../sessions/agent-orchestrator/support/messages";
import type { AgentChatMessage, SessionMessagesState } from "../types/agent-orchestrator";

export type SessionMessagesFixtureInput = SessionMessagesState | AgentChatMessage[] | undefined;

export const createSessionMessagesFixture = (
  externalSessionId: string,
  messages?: SessionMessagesFixtureInput,
): SessionMessagesState => {
  if (!messages) {
    return createSessionMessagesState(externalSessionId);
  }
  if (Array.isArray(messages)) {
    return createSessionMessagesState(externalSessionId, messages);
  }
  return createSessionMessagesState(externalSessionId, messages.items, messages.version);
};

export const sessionMessagesToArray = (owner: SessionMessageOwner): AgentChatMessage[] => {
  const messages: AgentChatMessage[] = [];
  forEachSessionMessage(owner, (message) => messages.push(message));
  return messages;
};

export const sessionMessageAt = (
  owner: SessionMessageOwner,
  index: number,
): AgentChatMessage | undefined => {
  return getSessionMessageAt(owner, index);
};

export const lastSessionMessageForTest = (
  owner: SessionMessageOwner,
): AgentChatMessage | undefined => {
  const count = getSessionMessageCount(owner);
  return count > 0 ? getSessionMessageAt(owner, count - 1) : undefined;
};

export const findSessionMessageForTest = (
  owner: SessionMessageOwner,
  predicate: (message: AgentChatMessage) => boolean,
): AgentChatMessage | undefined => {
  return sessionMessagesToArray(owner).find(predicate);
};
