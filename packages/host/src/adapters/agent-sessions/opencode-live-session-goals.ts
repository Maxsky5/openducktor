import type { AgentSessionGoal, AgentSessionLiveSnapshot } from "@openducktor/contracts";

/**
 * The last goal that the goal plugin reported for each session. Snapshot rebuilds from control
 * summaries and session reads keep it, because only the plugin changes it.
 */
export const createOpenCodeSessionGoals = () => {
  const goals = new Map<string, AgentSessionGoal>();
  const set = (externalSessionId: string, goal: AgentSessionGoal | null): void => {
    if (goal) goals.set(externalSessionId, goal);
    else goals.delete(externalSessionId);
  };
  return {
    /** Applies a reported goal. `null`: the session has no goal. */
    set,
    clear: (): void => goals.clear(),
    /** Gives the snapshot the reported goal, or no goal field. */
    apply: (snapshot: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot => {
      const { goal: _goal, ...rest } = snapshot;
      const goal = goals.get(snapshot.ref.externalSessionId);
      return goal ? { ...rest, goal } : rest;
    },
  };
};

export type OpenCodeSessionGoals = ReturnType<typeof createOpenCodeSessionGoals>;
