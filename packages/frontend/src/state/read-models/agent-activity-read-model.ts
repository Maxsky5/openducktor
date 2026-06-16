import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentActivitySessionSummary } from "@/state/agent-sessions-store";

type VisibleAgentActivityState = Extract<
  AgentActivitySessionSummary["activityState"],
  "starting" | "running" | "waiting_input"
>;

export type AgentActivitySessionItem = {
  externalSessionId: string;
  runtimeKind: AgentActivitySessionSummary["runtimeKind"];
  workingDirectory: string;
  taskId: string;
  taskTitle: string;
  role: AgentActivitySessionSummary["role"];
  activityState: VisibleAgentActivityState;
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
    if (session.activityState === "waiting_input") {
      waitingForInputSessions.push(toActivitySessionItem(session, taskTitleById, "waiting_input"));
      continue;
    }
    if (isAgentSessionActivityWorking(session.activityState)) {
      activeSessions.push(toActivitySessionItem(session, taskTitleById, session.activityState));
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

const toActivitySessionItem = (
  session: AgentActivitySessionSummary,
  taskTitleById: AgentActivityTaskTitleLookup | undefined,
  activityState: VisibleAgentActivityState,
): AgentActivitySessionItem => ({
  externalSessionId: session.externalSessionId,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
  taskId: session.taskId,
  taskTitle: taskTitleById?.[session.taskId] ?? session.taskId,
  role: session.role,
  activityState,
  startedAt: session.startedAt,
});
