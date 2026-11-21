import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  listAgentSessions,
  replaceAgentSession,
} from "../agent-session-collection";
import {
  createDeferred as createSharedDeferred,
  createTaskCardFixture as createSharedTaskCardFixture,
} from "../../test-support/shared-test-fixtures";
import type { AgentSessionState } from "../../types/agent-orchestrator";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

const ORCHESTRATOR_TASK_CARD_DEFAULTS: Partial<TaskCard> = {
  title: "Task",
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

export const createDeferred = createSharedDeferred;

export const createTaskCardFixture = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createSharedTaskCardFixture(ORCHESTRATOR_TASK_CARD_DEFAULTS, overrides);

export type AgentSessionCollectionRef = { current: AgentSessionCollection };

export const createAgentSessionCollectionRefFixture = (
  sessions: AgentSessionState[],
): AgentSessionCollectionRef => ({
  current: createAgentSessionCollection(sessions),
});

export const findAgentSessionFixture = (
  sessionsRef: AgentSessionCollectionRef,
  externalSessionId = "session-1",
): AgentSessionState | undefined =>
  listAgentSessions(sessionsRef.current).find(
    (session) => session.externalSessionId === externalSessionId,
  );

export const getAgentSessionFixture = (
  sessionsRef: AgentSessionCollectionRef,
  externalSessionId = "session-1",
): AgentSessionState => {
  const session = findAgentSessionFixture(sessionsRef, externalSessionId);
  if (!session) {
    throw new Error(`Expected session ${externalSessionId}`);
  }
  return session;
};

export const replaceAgentSessionFixture = (
  collection: AgentSessionCollection,
  session: AgentSessionState,
): AgentSessionCollection => replaceAgentSession(collection, session);
