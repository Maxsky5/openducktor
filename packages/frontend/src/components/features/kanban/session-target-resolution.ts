import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import type {
  KanbanSessionPresentationState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";

export type SessionTargetOptions = {
  externalSessionId?: string | null;
  scenario?: AgentScenario | null;
};

type PrimarySessionOrderingCandidate = {
  externalSessionId: string;
  status: KanbanTaskSession["status"];
  presentationState: KanbanSessionPresentationState;
  startedAt?: string;
};

const rankActiveSessionForPrimary = (session: PrimarySessionOrderingCandidate): number => {
  if (session.presentationState === "waiting_input") {
    return 0;
  }
  if (session.status === "running") {
    return 1;
  }
  if (session.status === "starting") {
    return 2;
  }
  return 3;
};

export const compareActiveSessionForPrimary = (
  left: PrimarySessionOrderingCandidate,
  right: PrimarySessionOrderingCandidate,
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

  if (left.externalSessionId === right.externalSessionId) {
    return 0;
  }

  return left.externalSessionId > right.externalSessionId ? -1 : 1;
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
  const externalSessionId =
    activeSession?.externalSessionId ?? historicalSession?.externalSessionId;
  const scenario = activeSession?.scenario ?? historicalSession?.scenario;

  if (!externalSessionId && !scenario) {
    return undefined;
  }

  return {
    ...(externalSessionId ? { externalSessionId } : {}),
    ...(scenario ? { scenario } : {}),
  };
};
