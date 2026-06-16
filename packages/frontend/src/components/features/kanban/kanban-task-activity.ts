import type { AgentRole } from "@openducktor/core";
import {
  type ActiveAgentSessionActivityState,
  isAgentSessionActivityActive,
} from "@/lib/agent-session-activity-state";
import {
  type AgentSessionSummary,
  isWorkflowAgentSessionSummary,
  type WorkflowAgentSessionSummary,
} from "@/state/agent-sessions-store";
import type { AgentSessionState, WorkflowAgentSessionState } from "@/types/agent-orchestrator";

export type KanbanSessionPresentationState = ActiveAgentSessionActivityState;

export type KanbanTaskActivityState = "idle" | "active" | "waiting_input";

export type ActiveTaskSessionContext = {
  role: AgentRole;
  presentationState: KanbanTaskSession["presentationState"];
};

export type ActiveTaskSessionContextByTaskId = Map<string, ActiveTaskSessionContext>;

export type KanbanTaskSession = Pick<
  WorkflowAgentSessionState,
  "externalSessionId" | "role" | "runtimeKind" | "workingDirectory"
> & {
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
