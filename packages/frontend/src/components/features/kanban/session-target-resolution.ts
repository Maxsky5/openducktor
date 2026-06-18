import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { KanbanTaskSession } from "@/components/features/kanban/kanban-task-activity";
import { compareActiveAgentSessionActivityState } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { ActiveAgentSessionActivityState } from "@/types/agent-session-activity";

export type SessionTargetOptions = {
  session: AgentSessionIdentity;
};

type PrimarySessionOrderingCandidate = {
  externalSessionId: string;
  runtimeKind: AgentSessionIdentity["runtimeKind"];
  workingDirectory: AgentSessionIdentity["workingDirectory"];
  activityState: ActiveAgentSessionActivityState;
  startedAt?: string;
};

export const compareActiveSessionForPrimary = (
  left: PrimarySessionOrderingCandidate,
  right: PrimarySessionOrderingCandidate,
): number => {
  const activityPriority = compareActiveAgentSessionActivityState(
    left.activityState,
    right.activityState,
  );
  if (activityPriority !== 0) {
    return activityPriority;
  }

  if (left.startedAt !== right.startedAt) {
    if (!left.startedAt) {
      return 1;
    }
    if (!right.startedAt) {
      return -1;
    }
    return left.startedAt > right.startedAt ? -1 : 1;
  }

  const leftIdentityKey = agentSessionIdentityKey(left);
  const rightIdentityKey = agentSessionIdentityKey(right);
  if (leftIdentityKey === rightIdentityKey) {
    return 0;
  }

  return leftIdentityKey > rightIdentityKey ? -1 : 1;
};

export const resolvePreferredActiveSession = (
  taskSessions: readonly KanbanTaskSession[],
  role: AgentRole,
): KanbanTaskSession | null => {
  const matchingTaskSessions = taskSessions.filter((session) => session.role === role);
  if (matchingTaskSessions.length === 0) {
    return null;
  }

  const [session] = matchingTaskSessions.toSorted(compareActiveSessionForPrimary);
  return session ?? null;
};

const resolveLatestHistoricalSessionByRole = (
  historicalSessions: readonly AgentSessionRecord[],
  role: AgentRole,
): AgentSessionRecord | null => {
  const matchingTaskAgentSessions = historicalSessions
    .filter((session) => session.role === role)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  return matchingTaskAgentSessions[0] ?? null;
};

export const resolveHistoricalSessionRoles = (
  historicalSessions: readonly AgentSessionRecord[],
): AgentRole[] => {
  const sortedTaskAgentSessions = historicalSessions.toSorted((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
  const roles: AgentRole[] = [];
  const seenRoles = new Set<AgentRole>();

  for (const session of sortedTaskAgentSessions) {
    if (seenRoles.has(session.role)) {
      continue;
    }
    seenRoles.add(session.role);
    roles.push(session.role);
  }

  return roles;
};

export const resolveSessionTargetOptions = (
  historicalSessions: readonly AgentSessionRecord[],
  taskSessions: readonly KanbanTaskSession[],
  role: AgentRole,
): SessionTargetOptions | undefined => {
  const activeSession = resolvePreferredActiveSession(taskSessions, role);
  const historicalSession = resolveLatestHistoricalSessionByRole(historicalSessions, role);
  const session = activeSession ?? historicalSession;

  if (!session) {
    return undefined;
  }

  return {
    session,
  };
};
