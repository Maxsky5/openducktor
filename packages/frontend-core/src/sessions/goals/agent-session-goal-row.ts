import type {
  AgentSessionGoal,
  AgentSessionGoalControlAction,
  AgentSessionGoalStatus,
} from "@openducktor/contracts";

const STATUS_LABELS = {
  active: "Active",
  paused: "Paused",
  blocked: "Blocked",
  limit_reached: "Limit reached",
  complete: "Complete",
  waiting_for_message: "Waiting for your message",
  ended: "Goal ended",
} satisfies Record<AgentSessionGoalStatus, string>;

/** The color family of a goal status, which each client maps to its own theme colors. */
export type AgentSessionGoalTone = "success" | "warning" | "danger" | "info" | "muted";

const STATUS_TONES = {
  active: "success",
  paused: "warning",
  blocked: "danger",
  limit_reached: "danger",
  complete: "success",
  waiting_for_message: "info",
  ended: "muted",
} satisfies Record<AgentSessionGoalStatus, AgentSessionGoalTone>;

const RESUMABLE_STATUSES = new Set<AgentSessionGoalStatus>(["paused", "blocked", "limit_reached"]);

export const WAITING_FOR_MESSAGE_DETAIL = "Your next message continues the goal.";

/** What the goal row above the composer shows for the goal that the runtime reports. */
export type AgentSessionGoalRow = {
  readonly objective: string;
  readonly status: AgentSessionGoalStatus;
  readonly statusLabel: string;
  readonly tone: AgentSessionGoalTone;
  /** The runtime reason, or how a waiting goal continues. */
  readonly detail: string | null;
  readonly actions: readonly AgentSessionGoalControlAction[];
};

export const buildAgentSessionGoalRow = (
  goal: AgentSessionGoal | undefined,
  supportsPauseResume: boolean,
): AgentSessionGoalRow | null => {
  if (!goal) return null;
  const actions: AgentSessionGoalControlAction[] = [];
  if (supportsPauseResume && goal.status === "active") actions.push("pause");
  if (supportsPauseResume && RESUMABLE_STATUSES.has(goal.status)) actions.push("resume");
  actions.push("clear");
  return {
    objective: goal.objective,
    status: goal.status,
    statusLabel: STATUS_LABELS[goal.status],
    tone: STATUS_TONES[goal.status],
    detail:
      goal.status === "waiting_for_message" ? WAITING_FOR_MESSAGE_DETAIL : (goal.reason ?? null),
    actions,
  };
};

export const AGENT_SESSION_GOAL_ACTION_LABELS = {
  pause: "Pause",
  resume: "Resume",
  clear: "Clear",
} satisfies Record<AgentSessionGoalControlAction, string>;
