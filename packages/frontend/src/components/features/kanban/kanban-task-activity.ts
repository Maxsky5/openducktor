import type { AgentRole } from "@openducktor/core";
import { isAgentSessionActivityActive } from "@/lib/agent-session-activity-state";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import {
  type AgentSessionSummary,
  isWorkflowAgentSessionSummary,
  type WorkflowAgentSessionSummary,
} from "@/state/agent-sessions-store";
import type {
  AgentSessionIdentity,
  AgentSessionState,
  WorkflowAgentSessionState,
} from "@/types/agent-orchestrator";
import type { ActiveAgentSessionActivityState } from "@/types/agent-session-activity";

export type KanbanSessionPresentationState = ActiveAgentSessionActivityState;

export type KanbanTaskActivityState = "idle" | "active" | "waiting_input";

export type ActiveTaskSessionContext = {
  role: AgentRole;
  presentationState: KanbanTaskSession["presentationState"];
};

export type ActiveTaskSessionContextByTaskId = Map<string, ActiveTaskSessionContext>;

export type KanbanTaskSession = AgentSessionIdentity &
  Pick<WorkflowAgentSessionState, "role"> & {
    startedAt?: AgentSessionState["startedAt"];
    presentationState: KanbanSessionPresentationState;
  };

export const toKanbanSessionPresentationState = (
  session: Pick<AgentSessionSummary, "activityState">,
): KanbanSessionPresentationState => {
  if (!isAgentSessionActivityActive(session.activityState)) {
    throw new Error(
      `Inactive session '${session.activityState}' cannot be shown as active Kanban work.`,
    );
  }
  return session.activityState;
};

export const toKanbanTaskSession = (session: WorkflowAgentSessionSummary): KanbanTaskSession => ({
  ...toAgentSessionIdentity(session),
  role: session.role,
  startedAt: session.startedAt,
  presentationState: toKanbanSessionPresentationState(session),
});

export const isKanbanActiveTaskSession = (
  session: AgentSessionSummary,
): session is WorkflowAgentSessionSummary => {
  if (!isWorkflowAgentSessionSummary(session)) {
    return false;
  }

  return isAgentSessionActivityActive(session.activityState);
};

export const toKanbanTaskActivityState = (
  taskSessions: Array<Pick<KanbanTaskSession, "presentationState">> | undefined,
): KanbanTaskActivityState => {
  if (!taskSessions || taskSessions.length === 0) {
    return "idle";
  }

  return taskSessions.some((session) => session.presentationState === "waiting_input")
    ? "waiting_input"
    : "active";
};
