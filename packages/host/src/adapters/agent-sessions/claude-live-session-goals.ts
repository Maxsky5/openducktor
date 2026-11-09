import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import type { ClaudeNativeGoal } from "../claude/claude-agent-sdk-types";

type GoalStatus = NonNullable<AgentSessionLiveSnapshot["goal"]>["status"];

const END_STATUS = {
  met: "complete",
  failed: "blocked",
  stopped: "ended",
} as const satisfies Record<NonNullable<ClaudeNativeGoal["end"]>, GoalStatus>;

type ProjectedGoal = { readonly goal: ClaudeNativeGoal; readonly clearing: boolean };

/**
 * Projects the goal that Claude keeps for each session. Claude continues a set goal only while it
 * works, or with the next user message. A met goal is complete, and an impossible goal is blocked.
 * The `/goal clear` turn of OpenDucktor does not work on the goal, so a clearing goal keeps its
 * idle status.
 */
export const createClaudeGoalProjection = () => {
  const goalsByKey = new Map<string, ProjectedGoal>();
  return {
    set: (key: string, goal: ClaudeNativeGoal | null, clearing = false): void => {
      if (goal) goalsByKey.set(key, { goal, clearing });
      else goalsByKey.delete(key);
    },
    clear: (): void => goalsByKey.clear(),
    project: (key: string, snapshot: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot => {
      const projected = goalsByKey.get(key);
      const next = { ...snapshot };
      if (!projected) {
        delete next.goal;
        return next;
      }
      const { goal, clearing } = projected;
      let status: GoalStatus = "active";
      if (goal.end) status = END_STATUS[goal.end];
      else if (clearing || snapshot.activity === "idle") status = "waiting_for_message";
      next.goal = { objective: goal.objective, status };
      return next;
    },
  };
};
