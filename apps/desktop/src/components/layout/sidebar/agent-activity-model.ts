import type { AgentSessionState } from "@/types/agent-orchestrator";

export type AgentActivitySessionItem = {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  role: AgentSessionState["role"];
  scenario: AgentSessionState["scenario"];
  status: AgentSessionState["status"];
  startedAt: string;
};

type AgentActivitySummary = {
  activeSessionCount: number;
  waitingForInputCount: number;
  activeSessions: AgentActivitySessionItem[];
  waitingForInputSessions: AgentActivitySessionItem[];
};

const ACTIVE_SESSION_STATUS: ReadonlySet<AgentSessionState["status"]> = new Set([
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
  if (left.sessionId === right.sessionId) {
    return 0;
  }
  return left.sessionId > right.sessionId ? -1 : 1;
};

export const summarizeAgentActivity = ({
  sessions,
  taskTitleById,
}: {
  sessions: AgentSessionState[];
  taskTitleById?: ReadonlyMap<string, string>;
}): AgentActivitySummary => {
  const activeSessions: AgentActivitySessionItem[] = [];
  const waitingForInputSessions: AgentActivitySessionItem[] = [];

  for (const session of sessions) {
    const sessionItem: AgentActivitySessionItem = {
      sessionId: session.sessionId,
      taskId: session.taskId,
      taskTitle: taskTitleById?.get(session.taskId) ?? session.taskId,
      role: session.role,
      scenario: session.scenario,
      status: session.status,
      startedAt: session.startedAt,
    };

    const isWaiting = session.pendingPermissions.length > 0 || session.pendingQuestions.length > 0;

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
