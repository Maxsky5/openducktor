import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

type VisibleAgentActivityState = Extract<
  AgentSessionSummary["activityState"],
  "starting" | "running" | "waiting_input"
>;

export type AgentActivitySessionItem = AgentSessionIdentity & {
  taskId: string;
  taskTitle: string;
  role: AgentSessionSummary["role"];
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
  sessions: AgentSessionSummary[];
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
  session: AgentSessionSummary,
  taskTitleById: AgentActivityTaskTitleLookup | undefined,
  activityState: VisibleAgentActivityState,
): AgentActivitySessionItem => ({
  ...toAgentSessionIdentity(session),
  taskId: session.taskId,
  taskTitle: taskTitleById?.[session.taskId] ?? session.taskId,
  role: session.role,
  activityState,
  startedAt: session.startedAt,
});
