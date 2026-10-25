import { isAgentSessionActivityActive } from "../../lib/agent-session-activity-state";
import { toAgentSessionIdentity } from "../../lib/agent-session-identity";
import type { AgentSessionSummary } from "../../sessions/agent-sessions-store";
import type { AgentSessionIdentity, AgentSessionState } from "../../types/agent-orchestrator";
import type { ActiveAgentSessionActivityState } from "../../types/agent-session-activity";
import type { BuiltinRoleId as AgentRole } from "@openducktor/workflows";

export type KanbanTaskActivityState = "idle" | "active" | "waiting_input";

export type ActiveAgentSessionSummary = AgentSessionSummary & {
  activityState: ActiveAgentSessionActivityState;
};

export type ActiveTaskSessionContext = {
  role: AgentRole;
  activityState: ActiveAgentSessionActivityState;
};

export type ActiveTaskSessionContextByTaskId = Map<string, ActiveTaskSessionContext>;

export type KanbanTaskSession = AgentSessionIdentity &
  Pick<AgentSessionSummary, "role" | "statusUnavailableReason" | "activityState"> & {
    startedAt?: AgentSessionState["startedAt"];
  };

export const toKanbanTaskSession = (session: AgentSessionSummary): KanbanTaskSession => ({
  ...toAgentSessionIdentity(session),
  role: session.role,
  startedAt: session.startedAt,
  activityState: session.activityState,
  statusUnavailableReason: session.statusUnavailableReason,
});

export const isKanbanActiveTaskSession = (
  session: AgentSessionSummary,
): session is ActiveAgentSessionSummary => {
  return isAgentSessionActivityActive(session.activityState, session.statusUnavailableReason);
};

export const toKanbanTaskActivityState = (
  taskSessions:
    | Array<Pick<KanbanTaskSession, "activityState" | "statusUnavailableReason">>
    | undefined,
): KanbanTaskActivityState => {
  if (!taskSessions || taskSessions.length === 0) {
    return "idle";
  }

  if (taskSessions.some((session) => session.activityState === "waiting_input"))
    return "waiting_input";
  return taskSessions.some((session) =>
    isAgentSessionActivityActive(session.activityState, session.statusUnavailableReason),
  )
    ? "active"
    : "idle";
};
