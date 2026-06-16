import type { AgentSessionState } from "@/types/agent-orchestrator";
import { isAgentSessionWaitingInput } from "./agent-session-waiting-input";

export type AgentSessionActivityState =
  | "waiting_input"
  | "starting"
  | "running"
  | "idle"
  | "stopped"
  | "error";
export type ActiveAgentSessionActivityState = Extract<
  AgentSessionActivityState,
  "waiting_input" | "starting" | "running"
>;
export type WorkingAgentSessionActivityState = Extract<
  AgentSessionActivityState,
  "starting" | "running"
>;
export type OptionalAgentSessionActivityState =
  | AgentSessionActivityState
  | "none"
  | null
  | undefined;
type AgentSessionStatus = AgentSessionState["status"];

const AGENT_SESSION_ACTIVITY_LABELS: Record<AgentSessionActivityState, string> = {
  waiting_input: "waiting input",
  starting: "starting",
  running: "running",
  idle: "idle",
  stopped: "stopped",
  error: "error",
};

export const formatAgentSessionActivityStateLabel = (
  activityState: AgentSessionActivityState,
): string => AGENT_SESSION_ACTIVITY_LABELS[activityState];

export const isAgentSessionActivityWorking = (
  activityState: OptionalAgentSessionActivityState,
): activityState is WorkingAgentSessionActivityState =>
  activityState === "starting" || activityState === "running";

export const isAgentSessionActivityActive = (
  activityState: OptionalAgentSessionActivityState,
): activityState is ActiveAgentSessionActivityState =>
  activityState === "waiting_input" || isAgentSessionActivityWorking(activityState);

export const getAgentSessionActivityState = ({
  status,
  hasPendingInput,
}: {
  status: AgentSessionStatus;
  hasPendingInput: boolean;
}): AgentSessionActivityState => {
  if (hasPendingInput) {
    return "waiting_input";
  }
  if (status === "starting") {
    return "starting";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "stopped") {
    return "stopped";
  }
  return "idle";
};

export const getAgentSessionActivityStateFromSession = (
  session: Pick<AgentSessionState, "status" | "pendingApprovals" | "pendingQuestions">,
): AgentSessionActivityState =>
  getAgentSessionActivityState({
    status: session.status,
    hasPendingInput: isAgentSessionWaitingInput(session),
  });
