import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import type { KanbanTaskSession } from "@/components/features/kanban/kanban-task-activity";

export type SessionTargetOptions = {
  sessionId?: string | null;
  scenario?: AgentScenario | null;
};

const rankActiveSessionForPrimary = (session: KanbanTaskSession): number => {
  if (session.presentationState === "waiting_input") {
    return 2;
  }
  if (session.status === "running") {
    return 0;
  }
  if (session.status === "starting") {
    return 1;
  }
  return 2;
};

const compareActiveSessionForPrimary = (
  left: KanbanTaskSession,
  right: KanbanTaskSession,
): number => {
  const leftRank = rankActiveSessionForPrimary(left);
  const rightRank = rankActiveSessionForPrimary(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
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

  if (left.sessionId === right.sessionId) {
    return 0;
  }

  return left.sessionId > right.sessionId ? -1 : 1;
};

export const resolvePreferredActiveSession = (
  taskSessions: readonly KanbanTaskSession[],
  role: AgentRole,
): KanbanTaskSession | null => {
  const matchingTaskSessions = taskSessions.filter((session) => session.role === role);
  if (matchingTaskSessions.length === 0) {
    return null;
  }

  const [session] = [...matchingTaskSessions].sort(compareActiveSessionForPrimary);
  return session ?? null;
};

export const resolveLatestHistoricalSessionByRole = (
  task: TaskCard,
  role: AgentRole,
): NonNullable<TaskCard["agentSessions"]>[number] | null => {
  const matchingTaskAgentSessions = (task.agentSessions ?? [])
    .filter((session) => session.role === role)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  return matchingTaskAgentSessions[0] ?? null;
};

export const resolveHistoricalSessionRoles = (task: TaskCard): AgentRole[] => {
  const sortedTaskAgentSessions = [...(task.agentSessions ?? [])].sort((left, right) =>
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
  task: TaskCard,
  taskSessions: readonly KanbanTaskSession[],
  role: AgentRole,
): SessionTargetOptions | undefined => {
  const activeSession = resolvePreferredActiveSession(taskSessions, role);
  const historicalSession = resolveLatestHistoricalSessionByRole(task, role);
  const sessionId = activeSession?.sessionId ?? historicalSession?.sessionId;
  const scenario = activeSession?.scenario ?? historicalSession?.scenario;

  if (!sessionId && !scenario) {
    return undefined;
  }

  return {
    ...(sessionId ? { sessionId } : {}),
    ...(scenario ? { scenario } : {}),
  };
};
