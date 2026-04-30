import {
  getSessionMessageAt,
  getSessionMessageCount,
  getSessionMessagesSlice,
  type SessionMessageOwner,
  someSessionMessage,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";

export const createSessionMessageOwner = (
  messages: AgentSessionState["messages"],
  externalSessionId = "session-1",
): SessionMessageOwner => ({
  externalSessionId,
  messages,
});

export const sessionMessagesToArray = (owner: SessionMessageOwner): AgentChatMessage[] => {
  return getSessionMessagesSlice(owner, 0);
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

export const filterSessionMessagesForTest = (
  owner: SessionMessageOwner,
  predicate: (message: AgentChatMessage) => boolean,
): AgentChatMessage[] => {
  return sessionMessagesToArray(owner).filter(predicate);
};

export const someSessionMessageForTest = (
  owner: SessionMessageOwner,
  predicate: (message: AgentChatMessage, index: number) => boolean,
): boolean => {
  return someSessionMessage(owner, predicate);
};
