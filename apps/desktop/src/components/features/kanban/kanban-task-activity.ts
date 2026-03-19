import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type KanbanSessionPresentationState = "active" | "waiting_input";

export type KanbanTaskActivityState = "idle" | "active" | "waiting_input";

export type KanbanActiveSession = Pick<
  AgentSessionState,
  "sessionId" | "role" | "scenario" | "status"
> & {
  runtimeKind?: AgentSessionState["runtimeKind"];
  presentationState: KanbanSessionPresentationState;
};

export const isKanbanSessionWaitingInput = (
  session: Pick<AgentSessionState, "pendingPermissions" | "pendingQuestions">,
): boolean => isAgentSessionWaitingInput(session);

export const toKanbanSessionPresentationState = (
  session: Pick<AgentSessionState, "pendingPermissions" | "pendingQuestions">,
): KanbanSessionPresentationState =>
  isKanbanSessionWaitingInput(session) ? "waiting_input" : "active";

export const toKanbanTaskActivityState = (
  activeSessions:
    | Array<
        | Pick<KanbanActiveSession, "presentationState">
        | { presentationState?: KanbanSessionPresentationState }
      >
    | undefined,
): KanbanTaskActivityState => {
  if (!activeSessions || activeSessions.length === 0) {
    return "idle";
  }

  return activeSessions.some((session) => session.presentationState === "waiting_input")
    ? "waiting_input"
    : "active";
};
