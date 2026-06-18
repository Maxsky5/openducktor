import type { AgentSessionState } from "@/types/agent-orchestrator";
import type {
  ActiveAgentSessionActivityState,
  AgentSessionActivityState,
  OptionalAgentSessionActivityState,
  WorkingAgentSessionActivityState,
} from "@/types/agent-session-activity";
import { isAgentSessionWaitingInput } from "./agent-session-waiting-input";

type AgentSessionStatus = AgentSessionState["status"];

const AGENT_SESSION_ACTIVITY_LABELS: Record<AgentSessionActivityState, string> = {
  waiting_input: "waiting input",
  starting: "starting",
  running: "running",
  idle: "idle",
  stopped: "stopped",
  error: "error",
};

const ACTIVE_AGENT_SESSION_ACTIVITY_PRIMARY_RANK: Record<ActiveAgentSessionActivityState, number> =
  {
    waiting_input: 0,
    running: 1,
    starting: 2,
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

export const compareActiveAgentSessionActivityState = (
  left: ActiveAgentSessionActivityState,
  right: ActiveAgentSessionActivityState,
): number =>
  ACTIVE_AGENT_SESSION_ACTIVITY_PRIMARY_RANK[left] -
  ACTIVE_AGENT_SESSION_ACTIVITY_PRIMARY_RANK[right];

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
