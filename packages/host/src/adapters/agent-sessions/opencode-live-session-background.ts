import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { type AgentSessionBackgroundWork, setSnapshotBackgroundWork } from "@openducktor/core";

/**
 * The last background work that the runtime reported for each session tree, and the reasons of
 * lost background tracking. A stored snapshot has neither, so snapshot rebuilds from control
 * summaries, session reads, and status events keep them. Only live events change them.
 */
export const createOpenCodeSessionBackground = () => {
  const work = new Map<string, AgentSessionBackgroundWork>();
  const lostTracking = new Map<string, string>();

  /**
   * Gives the snapshot its background work. Background work keeps the session running after
   * its reply ends, so the snapshot then has no foreground turn. A session with lost background
   * tracking has no known status.
   */
  const apply = (snapshot: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot => {
    const current = work.get(snapshot.ref.externalSessionId);
    const lostReason = lostTracking.get(snapshot.ref.externalSessionId);
    if (!current && !lostReason) return snapshot;
    const next: AgentSessionLiveSnapshot = { ...snapshot };
    if (lostReason && !next.statusUnavailableReason) next.statusUnavailableReason = lostReason;
    if (!current) return next;
    setSnapshotBackgroundWork(next, current);
    if (next.statusUnavailableReason) return next;
    if (next.activity === "idle")
      return { ...next, activity: "running", foregroundTurnActive: false };
    if (next.activity === "running") next.foregroundTurnActive = true;
    return next;
  };

  return {
    apply,
    /** Applies the reported work of the session tree. */
    set: (externalSessionId: string, next: AgentSessionBackgroundWork): void => {
      if (next.tasks.length > 0 || next.resultPending)
        work.set(externalSessionId, { tasks: next.tasks, resultPending: next.resultPending });
      else work.delete(externalSessionId);
    },
    /**
     * Records that the runtime cannot tell which background tasks the session has. No later
     * event of this runtime can tell it, so only the release of the session or runtime clears it.
     */
    loseTracking: (externalSessionId: string, reason: string): void => {
      lostTracking.set(externalSessionId, reason);
    },
    remove: (externalSessionId: string): void => {
      work.delete(externalSessionId);
      lostTracking.delete(externalSessionId);
    },
    clear: (): void => {
      work.clear();
      lostTracking.clear();
    },
  };
};
