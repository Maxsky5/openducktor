import type {
  AgentSessionActivity,
  AgentSessionBackgroundTask,
  AgentSessionGoalStatus,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { goalDrivesWork } from "./agent-session-goals";

/**
 * A session waits on background work when the agent writes no reply, no input blocks it, and a
 * background task still runs or a task result has not reached the agent yet. A goal that drives
 * the work keeps the session Running between its turns. The host and the clients use this rule.
 */
export const isAgentSessionWaitingOnBackground = (session: {
  readonly activity: AgentSessionActivity;
  readonly foregroundTurnActive?: boolean | undefined;
  readonly backgroundTasks?: ReadonlyArray<unknown> | undefined;
  readonly backgroundResultPending?: true | undefined;
  readonly goal?: { readonly status: AgentSessionGoalStatus } | null | undefined;
  readonly statusUnavailableReason?: string | null | undefined;
}): boolean =>
  !session.statusUnavailableReason &&
  session.activity === "running" &&
  session.foregroundTurnActive === false &&
  !goalDrivesWork(session.goal, true) &&
  ((session.backgroundTasks?.length ?? 0) > 0 || session.backgroundResultPending === true);

/** The background work of a session and its descendants. */
export type AgentSessionBackgroundWork = {
  /** The running tasks, oldest first. */
  readonly tasks: readonly AgentSessionBackgroundTask[];
  /** A task ended, but its result has not reached the agent yet. */
  readonly resultPending: boolean;
};

/** Replaces the background work fields of a snapshot. Work without a task or a result sets none. */
export const setSnapshotBackgroundWork = (
  snapshot: Pick<AgentSessionLiveSnapshot, "backgroundTasks" | "backgroundResultPending">,
  work: AgentSessionBackgroundWork | undefined,
): void => {
  delete snapshot.backgroundTasks;
  delete snapshot.backgroundResultPending;
  if (work && work.tasks.length > 0) snapshot.backgroundTasks = [...work.tasks];
  if (work?.resultPending) snapshot.backgroundResultPending = true;
};
