import {
  createSessionMessagesState,
  getSessionMessageAt,
  getSessionMessageCount,
  getSessionMessagesSlice,
  type SessionMessageOwner,
  someSessionMessage,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatMessage, SessionMessagesState } from "@/types/agent-orchestrator";
import { TEST_EXTERNAL_SESSION_IDS } from "./shared-test-fixtures";

type SessionMessageFixtureInput = SessionMessagesState | AgentChatMessage[];
export type SessionMessagesFixtureInput = SessionMessageFixtureInput | undefined;

export const createSessionMessagesFixture = (
  externalSessionId: string,
  messages?: SessionMessagesFixtureInput,
): SessionMessagesState => {
  if (!messages) {
    return createSessionMessagesState(externalSessionId);
  }
  return Array.isArray(messages)
    ? createSessionMessagesState(externalSessionId, messages)
    : messages;
};

export const createSessionMessageOwner = (
  messages: SessionMessageFixtureInput,
  externalSessionId = TEST_EXTERNAL_SESSION_IDS.default,
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
