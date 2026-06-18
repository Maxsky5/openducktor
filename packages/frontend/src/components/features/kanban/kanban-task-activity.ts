import type { AgentRole } from "@openducktor/core";
import { isAgentSessionActivityActive } from "@/lib/agent-session-activity-state";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { WorkflowAgentSessionSummary } from "@/state/agent-sessions-store";
import type {
  AgentSessionIdentity,
  AgentSessionState,
  WorkflowAgentSessionState,
} from "@/types/agent-orchestrator";
import type { ActiveAgentSessionActivityState } from "@/types/agent-session-activity";

export type KanbanTaskActivityState = "idle" | "active" | "waiting_input";

export type ActiveWorkflowAgentSessionSummary = WorkflowAgentSessionSummary & {
  activityState: ActiveAgentSessionActivityState;
};

export type ActiveTaskSessionContext = {
  role: AgentRole;
  activityState: KanbanTaskSession["activityState"];
};

export type ActiveTaskSessionContextByTaskId = Map<string, ActiveTaskSessionContext>;

export type KanbanTaskSession = AgentSessionIdentity &
  Pick<WorkflowAgentSessionState, "role"> & {
    startedAt?: AgentSessionState["startedAt"];
    activityState: ActiveAgentSessionActivityState;
  };

export const toKanbanTaskSession = (
  session: ActiveWorkflowAgentSessionSummary,
): KanbanTaskSession => ({
  ...toAgentSessionIdentity(session),
  role: session.role,
  startedAt: session.startedAt,
  activityState: session.activityState,
});

export const isKanbanActiveTaskSession = (
  session: WorkflowAgentSessionSummary,
): session is ActiveWorkflowAgentSessionSummary => {
  return isAgentSessionActivityActive(session.activityState);
};

export const toKanbanTaskActivityState = (
  taskSessions: Array<Pick<KanbanTaskSession, "activityState">> | undefined,
): KanbanTaskActivityState => {
  if (!taskSessions || taskSessions.length === 0) {
    return "idle";
  }

  return taskSessions.some((session) => session.activityState === "waiting_input")
    ? "waiting_input"
    : "active";
};
