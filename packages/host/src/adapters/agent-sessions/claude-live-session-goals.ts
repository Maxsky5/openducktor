import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import type { ClaudeNativeGoal } from "../claude/claude-agent-sdk-types";

/**
 * Projects the goal that Claude keeps for each session. Claude continues a set goal only while it
 * works, or with the next user message. A met goal is complete, and an impossible goal is blocked.
 */
export const createClaudeGoalProjection = () => {
  const goalsByKey = new Map<string, ClaudeNativeGoal>();
  return {
    set: (key: string, goal: ClaudeNativeGoal | null): void => {
      if (goal) goalsByKey.set(key, goal);
      else goalsByKey.delete(key);
    },
    clear: (): void => goalsByKey.clear(),
    project: (key: string, snapshot: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot => {
      const goal = goalsByKey.get(key);
      const next = { ...snapshot };
      if (!goal) {
        delete next.goal;
        return next;
      }
      let status: NonNullable<AgentSessionLiveSnapshot["goal"]>["status"] = "ended";
      if (!goal.ended) status = snapshot.activity === "idle" ? "waiting_for_message" : "active";
      else if (goal.outcome === "met") status = "complete";
      else if (goal.outcome === "failed") status = "blocked";
      next.goal = { objective: goal.objective, status };
      return next;
    },
  };
};
