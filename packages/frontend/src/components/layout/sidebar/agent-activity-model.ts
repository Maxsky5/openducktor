import type { AgentActivitySessionSummary } from "@/state/agent-sessions-store";

export type AgentActivitySessionItem = {
  externalSessionId: string;
  taskId: string;
  taskTitle: string;
  role: AgentActivitySessionSummary["role"];
  status: AgentActivitySessionSummary["status"];
  startedAt: string;
};

export type AgentActivitySummary = {
  activeSessionCount: number;
  waitingForInputCount: number;
  activeSessions: AgentActivitySessionItem[];
  waitingForInputSessions: AgentActivitySessionItem[];
};

export type AgentActivityTaskTitleLookup = Readonly<Record<string, string>>;

const ACTIVE_SESSION_STATUS: ReadonlySet<AgentActivitySessionSummary["status"]> = new Set([
  "starting",
  "running",
]);

const byNewestSession = (
  left: AgentActivitySessionItem,
  right: AgentActivitySessionItem,
): number => {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt > right.startedAt ? -1 : 1;
  }
  if (left.externalSessionId === right.externalSessionId) {
    return 0;
  }
  return left.externalSessionId > right.externalSessionId ? -1 : 1;
};

export const summarizeAgentActivity = ({
  sessions,
  taskTitleById,
}: {
  sessions: AgentActivitySessionSummary[];
  taskTitleById?: AgentActivityTaskTitleLookup;
}): AgentActivitySummary => {
  const activeSessions: AgentActivitySessionItem[] = [];
  const waitingForInputSessions: AgentActivitySessionItem[] = [];

  for (const session of sessions) {
    const sessionItem: AgentActivitySessionItem = {
      externalSessionId: session.externalSessionId,
      taskId: session.taskId,
      taskTitle: taskTitleById?.[session.taskId] ?? session.taskId,
      role: session.role,
      status: session.status,
      startedAt: session.startedAt,
    };

    const isWaiting = session.hasPendingPermissions || session.hasPendingQuestions;

    if (isWaiting) {
      waitingForInputSessions.push(sessionItem);
    } else if (ACTIVE_SESSION_STATUS.has(session.status)) {
      activeSessions.push(sessionItem);
    }
  }

  activeSessions.sort(byNewestSession);
  waitingForInputSessions.sort(byNewestSession);

  return {
    activeSessionCount: activeSessions.length,
    waitingForInputCount: waitingForInputSessions.length,
    activeSessions,
    waitingForInputSessions,
  };
};
