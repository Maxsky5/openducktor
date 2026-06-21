import {
  createSessionMessagesState,
  getSessionMessageAt,
  getSessionMessageCount,
  getSessionMessagesSlice,
  type SessionMessageOwner,
  someSessionMessage,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatMessage, SessionMessagesState } from "@/types/agent-orchestrator";

type SessionMessageFixtureInput = SessionMessagesState | AgentChatMessage[];
export type SessionMessagesFixtureInput = SessionMessageFixtureInput | undefined;
const DEFAULT_TEST_EXTERNAL_SESSION_ID = "external-1";

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
  if (messages.externalSessionId === externalSessionId) {
    return messages;
  }
  return createSessionMessagesState(
    externalSessionId,
    getSessionMessagesSlice({ externalSessionId: messages.externalSessionId, messages }, 0),
    messages.version,
  );
};

export const createSessionMessageOwner = (
  messages: SessionMessageFixtureInput,
  externalSessionId = DEFAULT_TEST_EXTERNAL_SESSION_ID,
): SessionMessageOwner => ({
  externalSessionId,
  messages: createSessionMessagesFixture(externalSessionId, messages),
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

export const someSessionMessageForTest = (
  owner: SessionMessageOwner,
  predicate: (message: AgentChatMessage, index: number) => boolean,
): boolean => {
  return someSessionMessage(owner, predicate);
};
