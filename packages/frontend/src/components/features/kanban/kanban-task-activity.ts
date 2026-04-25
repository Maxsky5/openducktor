import type { AgentRole } from "@openducktor/core";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type KanbanSessionPresentationState = "active" | "waiting_input";

export type KanbanTaskActivityState = "idle" | "active" | "waiting_input";

export type ActiveTaskSessionContext = {
  role: AgentRole;
  presentationState: KanbanTaskSession["presentationState"];
};

export type ActiveTaskSessionContextByTaskId = Map<string, ActiveTaskSessionContext>;

export type KanbanTaskSession = Pick<
  AgentSessionState,
  "sessionId" | "role" | "scenario" | "status"
> & {
  startedAt?: AgentSessionState["startedAt"];
  runtimeKind?: AgentSessionState["runtimeKind"];
  presentationState: KanbanSessionPresentationState;
};

const isKanbanSessionWaitingInput = (
  session: Pick<AgentSessionSummary, "pendingPermissions" | "pendingQuestions">,
): boolean => isAgentSessionWaitingInput(session);

export const toKanbanSessionPresentationState = (
  session: Pick<AgentSessionSummary, "pendingPermissions" | "pendingQuestions">,
): KanbanSessionPresentationState =>
  isKanbanSessionWaitingInput(session) ? "waiting_input" : "active";

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
