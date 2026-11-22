import { isAgentSessionWaitingOnBackground } from "@openducktor/core";
import type { AgentSessionState } from "../types/agent-orchestrator";
import {
  type AgentSessionReadModelLoadState,
  unresolvedLiveStreamFailure,
} from "../types/agent-session-read-model";
import type {
  ActiveAgentSessionActivityState,
  AgentSessionActivityState,
  OptionalAgentSessionActivityState,
  WorkingAgentSessionActivityState,
} from "../types/agent-session-activity";
import { isAgentSessionWaitingInput } from "./agent-session-waiting-input";

type AgentSessionStatus = AgentSessionState["status"];

const AGENT_SESSION_ACTIVITY_LABELS = {
  waiting_input: "waiting input",
  starting: "starting",
  running: "running",
  idle: "idle",
  stopped: "stopped",
  error: "error",
} satisfies Record<AgentSessionActivityState, string>;

const ACTIVE_AGENT_SESSION_ACTIVITY_PRIMARY_RANK = {
  waiting_input: 0,
  running: 1,
  starting: 2,
} satisfies Record<ActiveAgentSessionActivityState, number>;

/** The short label of the Background style of a running session. */
export const AGENT_SESSION_BACKGROUND_LABEL = "Background";

/** The long text of the Background style, for tooltips and assistive technology. */
export const AGENT_SESSION_BACKGROUND_DESCRIPTION = "Running and waiting on background tasks";

export const formatAgentSessionActivityStateLabel = (
  activityState: AgentSessionActivityState,
): string => AGENT_SESSION_ACTIVITY_LABELS[activityState];

export const isAgentSessionActivityWorking = (
  activityState: OptionalAgentSessionActivityState,
): activityState is WorkingAgentSessionActivityState =>
  activityState === "starting" || activityState === "running";

export const isAgentSessionForegroundActive = (
  session: Pick<
    AgentSessionState,
    "status" | "foregroundTurnActive" | "pendingUserMessageStartedAt"
  >,
): boolean =>
  session.status === "starting" ||
  session.pendingUserMessageStartedAt !== undefined ||
  (session.foregroundTurnActive ?? session.status === "running");

export const isAgentSessionActivityActive = (
  activityState: OptionalAgentSessionActivityState,
  statusUnavailableReason?: string | null,
): activityState is ActiveAgentSessionActivityState =>
  activityState === "waiting_input" ||
  (!statusUnavailableReason && isAgentSessionActivityWorking(activityState));

export const visibleSessionActivity = (
  activity: AgentSessionActivityState | null,
  statusUnavailableReason?: string | null,
): AgentSessionActivityState | null =>
  statusUnavailableReason && (activity === "idle" || isAgentSessionActivityWorking(activity))
    ? null
    : activity;

type AgentSessionBackgroundFacts = Parameters<typeof isAgentSessionWaitingInput>[0] &
  Pick<
    AgentSessionState,
    | "status"
    | "foregroundTurnActive"
    | "pendingUserMessageStartedAt"
    | "backgroundTasks"
    | "backgroundResultPending"
    | "goal"
    | "statusUnavailableReason"
  >;

/**
 * The running session has no reply and waits on background tasks. The session is Running; only
 * its style changes. Pending input wins, and a message that the user just sent counts as a reply.
 */
export const isAgentSessionWaitingOnBackgroundState = (
  session: AgentSessionBackgroundFacts,
): boolean =>
  // Almost no session has background work, so this check runs first on each store commit.
  ((session.backgroundTasks?.length ?? 0) > 0 || session.backgroundResultPending === true) &&
  session.status === "running" &&
  !isAgentSessionWaitingInput(session) &&
  isAgentSessionWaitingOnBackground({
    activity: "running",
    foregroundTurnActive: isAgentSessionForegroundActive(session),
    backgroundTasks: session.backgroundTasks,
    backgroundResultPending: session.backgroundResultPending,
    goal: session.goal,
    statusUnavailableReason: session.statusUnavailableReason,
  });

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

/** The reason when no live snapshot reported the session yet. */
const AGENT_SESSION_LIVE_STATE_UNREPORTED_REASON = "No live snapshot reported this session yet.";

/**
 * Why the live state of the session is unknown, or null when it is known. A snapshot that reported
 * the session keeps its live state while task records load or fail. A failed live stream makes the
 * reported live state unknown until a snapshot of a new observation reports the session again.
 */
export const getAgentSessionLiveStateUnavailableReason = (
  readModelLoadState: AgentSessionReadModelLoadState,
  session: Pick<AgentSessionState, "livePresence">,
): string | null => {
  if (readModelLoadState.kind === "ready") return null;
  const liveStreamFailure = unresolvedLiveStreamFailure(readModelLoadState);
  if (liveStreamFailure !== null) return liveStreamFailure;
  return session.livePresence === "present" ? null : AGENT_SESSION_LIVE_STATE_UNREPORTED_REASON;
};

/** True when the live state of the session is known. */
export const isAgentSessionLiveStateObserved = (
  readModelLoadState: AgentSessionReadModelLoadState,
  session: Pick<AgentSessionState, "livePresence">,
): boolean => getAgentSessionLiveStateUnavailableReason(readModelLoadState, session) === null;

/** The activity of a session when its live state is known, else null. */
export const getObservedAgentSessionActivityState = (
  readModelLoadState: AgentSessionReadModelLoadState,
  session: AgentSessionState | null,
): AgentSessionActivityState | null =>
  session && isAgentSessionLiveStateObserved(readModelLoadState, session)
    ? getAgentSessionActivityStateFromSession(session)
    : null;
