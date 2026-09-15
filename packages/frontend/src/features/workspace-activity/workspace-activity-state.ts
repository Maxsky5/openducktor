import {
  getAgentSessionActivityState,
  isAgentSessionActivityWorking,
} from "@/lib/agent-session-activity-state";
import type { AgentSessionTranscriptActivityFacts } from "@/state/operations/agent-orchestrator/session-read-model/agent-session-live-activity";

/**
 * One live session of a workspace, reduced to the facts a tile badge needs.
 *
 * The record keeps no transcript, no message, and no context usage, so the
 * projection cost stays independent of transcript size.
 */
export type WorkspaceActivitySession = AgentSessionTranscriptActivityFacts & {
  /** Identity key of this session, used as its map key. */
  key: string;
  /** Identity key of the parent session when this session is a subagent. */
  parentKey: string | null;
  executionEpisodeId?: string | undefined;
};

export type WorkspaceActivityBadges = {
  inputRequired: boolean;
  error: boolean;
  active: boolean;
};

export type WorkspaceActivityState =
  | { kind: "unknown" }
  | ({ kind: "ready" } & WorkspaceActivityBadges)
  | { kind: "unavailable"; reason: string };

export const UNKNOWN_WORKSPACE_ACTIVITY: WorkspaceActivityState = { kind: "unknown" };

export const sameWorkspaceActivityState = (
  left: WorkspaceActivityState,
  right: WorkspaceActivityState,
): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "unavailable") {
    return right.kind === "unavailable" && left.reason === right.reason;
  }
  if (left.kind === "ready") {
    return (
      right.kind === "ready" &&
      left.inputRequired === right.inputRequired &&
      left.error === right.error &&
      left.active === right.active
    );
  }
  return true;
};

/**
 * Walk to the topmost reachable ancestor of a session.
 *
 * A subagent whose parent is not reported is its own owner, so real runtime
 * activity is reported instead of dropped.
 */
const resolveOwnerKey = (
  sessions: ReadonlyMap<string, WorkspaceActivitySession>,
  key: string,
): string => {
  let ownerKey = key;
  const visited = new Set([key]);
  for (;;) {
    const parentKey = sessions.get(ownerKey)?.parentKey ?? null;
    if (parentKey === null || visited.has(parentKey) || !sessions.has(parentKey)) {
      return ownerKey;
    }
    visited.add(parentKey);
    ownerKey = parentKey;
  }
};

/**
 * Reduce the live sessions of one workspace to the three badge booleans.
 *
 * Subagent pending input is attributed to its nearest reported ancestor, the
 * same attribution the Agent Studio read model performs.
 */
export const foldWorkspaceActivityBadges = (
  sessions: ReadonlyMap<string, WorkspaceActivitySession>,
  archivedSessionKeys: ReadonlySet<string>,
): WorkspaceActivityBadges => {
  const counted = new Map<string, WorkspaceActivitySession>();
  for (const [key, session] of sessions) {
    if (!archivedSessionKeys.has(key)) {
      counted.set(key, session);
    }
  }

  const ownerKeys = new Map<string, string>();
  const pendingInputOwnerKeys = new Set<string>();
  for (const [key, session] of counted) {
    const ownerKey = resolveOwnerKey(counted, key);
    ownerKeys.set(key, ownerKey);
    if (session.pendingApprovals.length > 0 || session.pendingQuestions.length > 0) {
      pendingInputOwnerKeys.add(ownerKey);
    }
  }

  let inputRequired = false;
  let error = false;
  let active = false;
  for (const [key, session] of counted) {
    if (ownerKeys.get(key) !== key) {
      continue;
    }
    const activityState = getAgentSessionActivityState({
      status: session.status,
      hasPendingInput: pendingInputOwnerKeys.has(key),
    });
    if (activityState === "waiting_input") {
      inputRequired = true;
      continue;
    }
    if (isAgentSessionActivityWorking(activityState)) {
      active = true;
      continue;
    }
    if (activityState === "error") {
      error = true;
    }
  }

  return { inputRequired, error, active };
};
