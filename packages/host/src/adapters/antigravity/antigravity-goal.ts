import { type AgentSessionGoal, GOAL_SLASH_COMMAND } from "@openducktor/contracts";

/**
 * Antigravity tells the agent of a `/goal` request to end its reply with one of these markers. ACP
 * sends no goal state, so the markers in the reply text are the only end of a goal.
 * https://antigravity.google/docs/commands/goal
 */
const GOAL_END_MARKERS = new Map([
  ["met", "<!-- GOAL_COMPLETE -->"],
  ["cancelled", "<!-- GOAL_CANCELLED -->"],
] as const);

/** The end of a goal that the agent reports. */
export type AntigravityGoalEnd = "met" | "cancelled";

/** The goal of a session, from its last `/goal` message and the end that the agent reported. */
export type AntigravityGoal = {
  readonly objective: string;
  readonly end?: AntigravityGoalEnd;
};

/**
 * Antigravity has no command that clears a goal. Its documentation cancels a goal with a message
 * that asks the agent to stop it, and the agent then ends its reply with the cancelled marker.
 */
export const ANTIGRAVITY_GOAL_STOP_MESSAGE = "Stop the current goal. I'll take it from here.";

const GOAL_PREFIX = `/${GOAL_SLASH_COMMAND.trigger}`;

/** The objective of a `/goal <objective>` message, or null for another message. */
export const readAntigravityGoalObjective = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(GOAL_PREFIX)) return null;
  const rest = trimmed.slice(GOAL_PREFIX.length);
  if (rest.length > 0 && !/^\s/.test(rest)) return null;
  const objective = rest.trim();
  return objective.length > 0 ? objective : null;
};

/** Reply text without its goal markers, and the ends that the markers report in text order. */
type AntigravityGoalMarkerRead = {
  readonly text: string;
  readonly ends: AntigravityGoalEnd[];
};

/** Removes the goal markers: comments that the agent writes for Antigravity, not for the user. */
export const stripAntigravityGoalMarkers = (text: string): AntigravityGoalMarkerRead => {
  const found: Array<{ readonly index: number; readonly end: AntigravityGoalEnd }> = [];
  for (const [end, marker] of GOAL_END_MARKERS) {
    for (let index = text.indexOf(marker); index >= 0; index = text.indexOf(marker, index + 1)) {
      found.push({ index, end });
    }
  }
  if (found.length === 0) return { text, ends: [] };
  let stripped = text;
  for (const marker of GOAL_END_MARKERS.values()) stripped = stripped.replaceAll(marker, "");
  return {
    text: stripped,
    ends: found.toSorted((left, right) => left.index - right.index).map(({ end }) => end),
  };
};

const LONGEST_MARKER = Math.max(...[...GOAL_END_MARKERS.values()].map((marker) => marker.length));

/**
 * The length of the end of the text that can still grow into a marker. A stream holds it back, so
 * no part of a marker shows before the marker completes.
 */
export const pendingAntigravityGoalMarkerLength = (text: string): number => {
  for (let length = Math.min(text.length, LONGEST_MARKER - 1); length > 0; length -= 1) {
    const tail = text.slice(-length);
    for (const marker of GOAL_END_MARKERS.values()) if (marker.startsWith(tail)) return length;
  }
  return 0;
};

/**
 * The goal state that a session snapshot shows. Antigravity continues a goal only while it works,
 * or with the next user message. A goal that the agent completed is complete, and a goal that it
 * cancelled without the stop message of OpenDucktor ended.
 */
export const toAntigravityGoalSnapshot = (
  goal: AntigravityGoal | null,
  working: boolean,
): AgentSessionGoal | undefined => {
  if (!goal) return undefined;
  const { objective } = goal;
  if (goal.end === "met") return { objective, status: "complete" };
  if (goal.end === "cancelled")
    return { objective, status: "ended", reason: "The agent cancelled the goal." };
  return { objective, status: working ? "active" : "waiting_for_message" };
};

/**
 * The goal of a session, from its user messages and the goal markers of the replies. A `/goal`
 * message sets the goal, and a new one replaces the goal before it. The stop message of
 * OpenDucktor asks the agent to cancel the goal, so its cancel removes the goal.
 */
export class AntigravityGoalTracker {
  private state: AntigravityGoal | null = null;
  /** True when the last user message asked the agent to stop its goal. */
  private stopAsked = false;

  get goal(): AntigravityGoal | null {
    return this.state;
  }

  /** Removes a goal that the agent already ended. It returns false when no ended goal is set. */
  forgetEnded(): boolean {
    if (!this.state?.end) return false;
    this.state = null;
    return true;
  }

  noteMessage(text: string): void {
    const objective = readAntigravityGoalObjective(text);
    if (objective) this.state = { objective };
    this.stopAsked = objective === null && text.trim() === ANTIGRAVITY_GOAL_STOP_MESSAGE;
  }

  noteEnds(ends: readonly AntigravityGoalEnd[]): void {
    for (const end of ends) {
      if (!this.state || this.state.end) continue;
      this.state = end === "cancelled" && this.stopAsked ? null : { ...this.state, end };
    }
  }
}
