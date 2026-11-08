// The goal row of agent-chat-goal-row.tsx and agent-chat-goal-row.css: the goal of the session on
// the top edge of the composer. The label Goal, the status in its tone, and the objective share one
// line. A click opens the whole objective. The actions follow agent-session-goal-row.ts in
// packages/frontend-core: Pause goal while the goal is active, Resume goal while it waits, and Clear
// goal always. A runtime without pause and resume shows only Clear goal. goal-row.ts changes the
// status and opens the row.
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePause,
  type LucideIcon,
  Pause,
  Play,
  Target,
  X,
} from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import "./GoalRow.css";

/** The goal states of agentSessionGoalStatusSchema in packages/contracts. */
export type GoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "limit_reached"
  | "complete"
  | "waiting_for_message"
  | "ended";

/** The status labels of agent-session-goal-row.ts. */
export const GOAL_STATUS_LABELS = {
  active: "Active",
  paused: "Paused",
  blocked: "Blocked",
  limit_reached: "Limit reached",
  complete: "Complete",
  waiting_for_message: "Waiting for your message",
  ended: "Goal ended",
} as const satisfies Record<GoalStatus, string>;

/** The tone of each status: blue work, a green goal that is met, amber or red when it waits. */
export const GOAL_STATUS_TONES = {
  active: "info",
  paused: "warning",
  blocked: "danger",
  limit_reached: "danger",
  complete: "success",
  waiting_for_message: "warning",
  ended: "muted",
} as const satisfies Record<GoalStatus, string>;

/** The icon of each status in agent-chat-goal-row.tsx, by its name in `data-icon`. */
export const GOAL_STATUS_ICONS = {
  active: "target",
  paused: "pause",
  blocked: "alert",
  limit_reached: "alert",
  complete: "check",
  waiting_for_message: "pause",
  ended: "dashed",
} as const satisfies Record<GoalStatus, string>;

type IconName = (typeof GOAL_STATUS_ICONS)[GoalStatus];

const ICONS = {
  target: Target,
  pause: CirclePause,
  alert: CircleAlert,
  check: CircleCheck,
  dashed: CircleDashed,
} as const satisfies Record<IconName, LucideIcon>;

/** The labels of the action buttons: AGENT_SESSION_GOAL_ACTION_LABELS and the word goal. */
export const GOAL_ACTION_LABELS = {
  pause: "Pause goal",
  resume: "Resume goal",
  clear: "Clear goal",
} as const;

type GoalAction = keyof typeof GOAL_ACTION_LABELS;

const ACTION_ICONS = { pause: Pause, resume: Play, clear: X } as const satisfies Record<
  GoalAction,
  LucideIcon
>;

type GoalRowProps = {
  objective: string;
  status: GoalStatus;
  /** The runtime can pause and resume a goal: supportsPauseResume of its descriptor. */
  pausable: boolean;
  /** The row shows the whole objective. */
  expanded?: boolean;
  /** The row waits for the scene, which raises it out of the composer. */
  hidden?: boolean;
};

export function GoalRow({
  objective,
  status,
  pausable,
  expanded = false,
  hidden = false,
}: GoalRowProps): ReactElement {
  return (
    <section
      className="gr"
      aria-label="Goal"
      data-goal-row=""
      data-status={status}
      data-tone={GOAL_STATUS_TONES[status]}
      data-icon={GOAL_STATUS_ICONS[status]}
      data-pausable={flag(pausable)}
      hidden={hidden}
    >
      <div className="gr-card">
        <span className="gr-toggle" data-goal-toggle="">
          <span
            className="gr-line"
            data-expanded={String(expanded)}
            data-clamped={String(!expanded)}
            data-goal-line=""
          >
            {Object.entries(ICONS).map(([name, Icon]) => (
              <Icon className="gr-icon" data-icon={name} key={name} />
            ))}
            <b className="gr-label">Goal</b>{" "}
            <span className="gr-status" data-goal-status="">
              {GOAL_STATUS_LABELS[status]}
            </span>{" "}
            <span className="gr-objective">{objective}</span>
          </span>
          <ChevronDown
            className="gr-chevron"
            data-expanded={String(expanded)}
            data-goal-chevron=""
          />
        </span>
        <span className="gr-actions">
          {Object.entries(ACTION_ICONS).map(([action, Icon]) => (
            <span className="gr-action" data-goal-action={action} key={action}>
              <Icon />
            </span>
          ))}
        </span>
      </div>
    </section>
  );
}
