import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { setSnapshotBackgroundWork } from "@openducktor/core";
import type { ClaudeSessionBackgroundTasks } from "../claude/claude-agent-sdk-types";

/** Projects the background tasks that the Claude adapter reports for each session of a tree. */
export const createClaudeBackgroundTaskProjection = () => {
  const tasksByKey = new Map<string, ClaudeSessionBackgroundTasks>();
  const keysByRootKey = new Map<string, readonly string[]>();

  const clearTree = (rootKey: string): readonly string[] => {
    const keys = keysByRootKey.get(rootKey) ?? [];
    keysByRootKey.delete(rootKey);
    for (const key of keys) tasksByKey.delete(key);
    return keys;
  };

  return {
    /** Replaces the lists of a root tree. Returns the keys of the sessions whose lists changed. */
    set: (
      rootKey: string,
      sessions: ReadonlyMap<string, ClaudeSessionBackgroundTasks>,
    ): string[] => {
      const previous = clearTree(rootKey);
      for (const [key, session] of sessions) tasksByKey.set(key, session);
      keysByRootKey.set(rootKey, [...sessions.keys()]);
      return [...new Set([...previous, ...sessions.keys()])];
    },
    clearTree,
    /** An idle root has no background work, so its snapshot drops the list with its idle state. */
    clearSession: (key: string): void => {
      tasksByKey.delete(key);
    },
    removeSession: (key: string): void => {
      clearTree(key);
      tasksByKey.delete(key);
    },
    clear: (): void => {
      tasksByKey.clear();
      keysByRootKey.clear();
    },
    /** Adds the background work to the snapshot. It changes the fresh copy that the caller gives. */
    project: (key: string, next: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot => {
      const work = tasksByKey.get(key);
      setSnapshotBackgroundWork(next, work);
      // Claude reports no foreground turn for a subagent. A subagent whose part ended can still
      // own a running task, so it then waits on that task, as an OpenCode child does.
      if (next.parentExternalSessionId !== undefined) {
        delete next.foregroundTurnActive;
        if (work && next.activity === "idle" && !next.statusUnavailableReason) {
          next.activity = "running";
          next.foregroundTurnActive = false;
        }
      }
      return next;
    },
  };
};
