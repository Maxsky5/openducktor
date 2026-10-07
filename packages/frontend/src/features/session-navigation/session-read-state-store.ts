import type { WorkspaceSessionLiveSnapshot } from "@/features/workspace-activity/workspace-activity-observer";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";

/** Read marks use the same identity for a saved task or workspace conversation. */
export const sessionReadStateKey = (workspaceId: string, identity: AgentSessionIdentity): string =>
  readKey(workspaceId, agentSessionIdentityKey(identity));

type Activity = "running" | "waiting_input" | "idle";

type Baseline = {
  activity: Activity;
  pendingInputs: ReadonlySet<string>;
};

export type SessionReadStateStore = {
  subscribe(listener: () => void): () => void;
  isUnread(key: string): boolean;
  setUnread(key: string, value: boolean): void;
  setVisibleKey(key: string | null): void;
  observeLiveSnapshot(snapshot: WorkspaceSessionLiveSnapshot): void;
  observeTaskBlocks(
    workspaceId: string,
    tasks: readonly { taskId: string; blocked: boolean; readKey: string | null }[],
  ): void;
};

/**
 * Keep app-lifetime read marks separate from the live baseline for future persistence.
 * New observations start seen; only a confirmed change can make a conversation unread.
 */
export const createSessionReadStateStore = (): SessionReadStateStore => {
  const listeners = new Set<() => void>();
  const unread = new Set<string>();
  const baselinesByWorkspace = new Map<string, Map<string, Baseline>>();
  const blockedByWorkspace = new Map<string, Map<string, boolean>>();
  let visibleKey: string | null = null;

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const markUnread = (key: string): boolean => {
    if (key === visibleKey || unread.has(key)) return false;
    unread.add(key);
    return true;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isUnread: (key) => unread.has(key),
    setUnread(key, value) {
      if (unread.has(key) === value) return;
      if (value) unread.add(key);
      else unread.delete(key);
      emit();
    },
    setVisibleKey(key) {
      visibleKey = key;
      if (key !== null && unread.delete(key)) emit();
    },
    observeLiveSnapshot(snapshot) {
      let changed = false;
      for (const [workspaceId, live] of snapshot.statesByWorkspaceId) {
        // A lost stream or failed status read cannot confirm that work finished.
        if (live.kind !== "ready") continue;
        const baselines = baselinesByWorkspace.get(workspaceId) ?? new Map<string, Baseline>();
        for (const [identityKey, facts] of live.sessions) {
          if (
            facts.statusUnavailableReason !== null ||
            live.faults.get(identityKey)?.statusUnavailable
          )
            continue;
          const activity = readActivity(facts.activityState);
          const before = baselines.get(identityKey);
          if (
            before !== undefined &&
            ((before.activity !== activity && activity !== "running") ||
              hasNewInput(facts.pendingInputs, before.pendingInputs))
          ) {
            if (markUnread(readKey(workspaceId, identityKey))) changed = true;
          }
          baselines.set(identityKey, { activity, pendingInputs: facts.pendingInputs });
        }
        // Removal from a current live list confirms that the saved session is idle.
        for (const [identityKey, before] of baselines) {
          if (
            before.activity === "idle" ||
            live.sessions.has(identityKey) ||
            live.faults.get(identityKey)?.statusUnavailable
          )
            continue;
          baselines.set(identityKey, { activity: "idle", pendingInputs: new Set<string>() });
          if (markUnread(readKey(workspaceId, identityKey))) changed = true;
        }
        baselinesByWorkspace.set(workspaceId, baselines);
      }
      if (changed) emit();
    },
    observeTaskBlocks(workspaceId, tasks) {
      const baselines = blockedByWorkspace.get(workspaceId) ?? new Map<string, boolean>();
      const current = new Set(tasks.map((task) => task.taskId));
      let changed = false;
      for (const task of tasks) {
        // Keep the prior state until the session list confirms which row owns the blocker.
        if (task.blocked && task.readKey === null) continue;
        const before = baselines.get(task.taskId);
        baselines.set(task.taskId, task.blocked);
        if (before === false && task.blocked && task.readKey !== null) {
          if (markUnread(task.readKey)) changed = true;
        }
      }
      for (const taskId of baselines.keys()) {
        if (!current.has(taskId)) baselines.delete(taskId);
      }
      blockedByWorkspace.set(workspaceId, baselines);
      if (changed) emit();
    },
  };
};

const readKey = (workspaceId: string, identityKey: string): string =>
  JSON.stringify([workspaceId, identityKey]);

const readActivity = (state: AgentSessionActivityState): Activity => {
  if (isAgentSessionActivityWorking(state)) return "running";
  if (state === "waiting_input") return "waiting_input";
  return "idle";
};

const hasNewInput = (current: ReadonlySet<string>, before: ReadonlySet<string>): boolean => {
  for (const key of current) {
    if (!before.has(key)) return true;
  }
  return false;
};
