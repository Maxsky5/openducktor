import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { isAgentSessionWorkingStatus } from "@/lib/agent-session-status";
import type { AgentActivitySessionSummary } from "@/state/agent-sessions-store";

export type AgentActivitySessionItem = {
  externalSessionId: string;
  runtimeKind: AgentActivitySessionSummary["runtimeKind"];
  workingDirectory: string;
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

const byNewestSession = (
  left: AgentActivitySessionItem,
  right: AgentActivitySessionItem,
): number => {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt > right.startedAt ? -1 : 1;
  }
  const leftSessionKey = agentSessionIdentityKey(left);
  const rightSessionKey = agentSessionIdentityKey(right);
  if (leftSessionKey === rightSessionKey) {
    return 0;
  }
  return leftSessionKey > rightSessionKey ? -1 : 1;
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
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
      taskId: session.taskId,
      taskTitle: taskTitleById?.[session.taskId] ?? session.taskId,
      role: session.role,
      status: session.status,
      startedAt: session.startedAt,
    };

    const isWaiting = session.hasPendingApprovals || session.hasPendingQuestions;

    if (isWaiting) {
      waitingForInputSessions.push(sessionItem);
    } else if (isAgentSessionWorkingStatus(session.status)) {
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
