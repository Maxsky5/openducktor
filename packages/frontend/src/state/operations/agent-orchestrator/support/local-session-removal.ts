import type { AgentRole } from "@openducktor/core";
import {
  type AgentSessionCollection,
  removeAgentSessions as removeAgentSessionsFromCollection,
} from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { SessionObservers } from "./session-observers";
import { clearSessionsTransientState, type SessionTransientState } from "./session-transient-state";

type CommitSessionCollection = (
  updater: (current: AgentSessionCollection) => AgentSessionCollection,
) => void;

export const selectSessionsForTaskRemoval = (
  sessions: readonly AgentSessionState[],
  { taskId, roles }: { taskId: string; roles: AgentRole[] | undefined },
): AgentSessionIdentity[] => {
  const matchingRoles = roles ? new Set(roles) : null;
  return sessions.filter(
    (session) =>
      session.taskId === taskId &&
      (matchingRoles === null || (session.role !== null && matchingRoles.has(session.role))),
  );
};

export const removeLocalAgentSessions = ({
  sessions,
  commitSessionCollection,
  sessionObservers,
  sessionTransientState,
}: {
  sessions: readonly AgentSessionIdentity[];
  commitSessionCollection: CommitSessionCollection;
  sessionObservers: SessionObservers;
  sessionTransientState: SessionTransientState;
}): void => {
  if (sessions.length === 0) {
    return;
  }

  commitSessionCollection((currentSessions) =>
    removeAgentSessionsFromCollection(currentSessions, sessions),
  );
  sessionObservers.removeMany(sessions);
  clearSessionsTransientState(sessionTransientState, sessions);
};
