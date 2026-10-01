import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import {
  getAgentSessionActivityState,
  isAgentSessionActivityWorking,
} from "@/lib/agent-session-activity-state";
import { laterTime } from "@/lib/timestamps";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
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
  /** Epoch milliseconds of the latest observed event that changed this session's activity. */
  lastActivityAt: number | null;
  /**
   * True after a snapshot changed the status. A snapshot has no event time, so the next
   * transcript event of the session gives that change its time.
   */
  untimedStatusChange: boolean;
  /** Why the status of this session is not current, after a failed status read. */
  statusUnavailableReason: string | null;
  /** Small live preview data. This keeps no transcript, messages, or context usage. */
  preview?: Pick<
    AgentSessionLiveSnapshot,
    "ref" | "model" | "title" | "repositoryScope" | "pendingApprovals" | "pendingQuestions"
  >;
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
export const resolveWorkspaceSessionOwnerKey = (
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
 * Decide whether a session belongs to an archived chat.
 *
 * A live subagent of an archived chat must not report activity for that chat,
 * so a session is excluded when its own key or any reachable ancestor key is
 * archived.
 */
const isArchivedBranch = (
  sessions: ReadonlyMap<string, WorkspaceActivitySession>,
  archivedSessionKeys: ReadonlySet<string>,
  key: string,
): boolean => {
  let current = key;
  const visited = new Set([key]);
  for (;;) {
    if (archivedSessionKeys.has(current)) {
      return true;
    }
    // The archived keys come from the chat records, so an ancestor is checked
    // even when the live stream no longer reports it. Archiving a chat stops
    // its session, which is when a lingering subagent has no reported parent.
    const parentKey = sessions.get(current)?.parentKey ?? null;
    if (parentKey === null || visited.has(parentKey)) {
      return false;
    }
    visited.add(parentKey);
    current = parentKey;
  }
};

/**
 * Live facts of one reported root session.
 *
 * Subagent pending input and activity time count for the root that owns them,
 * so a sidebar entry shows the attention of its whole conversation.
 */
export type WorkspaceSessionLiveFacts = {
  activityState: AgentSessionActivityState;
  pendingQuestion: boolean;
  pendingPermission: boolean;
  /** Epoch milliseconds of the latest observed activity change in the conversation. */
  lastActivityAt: number | null;
  fault: string | null;
  /** Why the status of the root session is not current, after a failed status read. */
  statusUnavailableReason: string | null;
};

/** A session-scoped observation fault. */
export type WorkspaceSessionFault = {
  message: string;
  /** The current status of the session could not be read, so its live facts can be stale. */
  statusUnavailable: boolean;
};

export type WorkspaceSessionLiveState =
  | { kind: "unknown" }
  | {
      kind: "ready";
      sessions: ReadonlyMap<string, WorkspaceSessionLiveFacts>;
      /** Session faults by identity key, also for a session without live facts. */
      faults: ReadonlyMap<string, WorkspaceSessionFault>;
    }
  | {
      kind: "unavailable";
      reason: string;
      /** Facts known before observation stopped. They can be out of date. */
      sessions: ReadonlyMap<string, WorkspaceSessionLiveFacts>;
      faults: ReadonlyMap<string, WorkspaceSessionFault>;
    };

export const UNKNOWN_WORKSPACE_SESSION_LIVE_STATE: WorkspaceSessionLiveState = { kind: "unknown" };

type MutableLiveFacts = {
  status: WorkspaceActivitySession["status"];
  statusUnavailableReason: string | null;
  pendingQuestion: boolean;
  pendingPermission: boolean;
  lastActivityAt: number | null;
  fault: string | null;
};

/** Reduce the live sessions of one workspace to one fact record per root, keyed by identity. */
export const foldWorkspaceSessionLiveFacts = (
  sessions: ReadonlyMap<string, WorkspaceActivitySession>,
  faults: ReadonlyMap<string, WorkspaceSessionFault>,
): ReadonlyMap<string, WorkspaceSessionLiveFacts> => {
  const owners = new Map<string, MutableLiveFacts>();
  for (const [key, session] of sessions) {
    const ownerKey = resolveWorkspaceSessionOwnerKey(sessions, key);
    const owner = owners.get(ownerKey) ?? {
      status: sessions.get(ownerKey)?.status ?? session.status,
      statusUnavailableReason: sessions.get(ownerKey)?.statusUnavailableReason ?? null,
      pendingQuestion: false,
      pendingPermission: false,
      lastActivityAt: null,
      fault: null,
    };
    owner.pendingQuestion ||= session.pendingQuestions.length > 0;
    owner.pendingPermission ||= session.pendingApprovals.length > 0;
    owner.lastActivityAt = laterTime(owner.lastActivityAt, session.lastActivityAt);
    owner.fault ??= faults.get(key)?.message ?? null;
    owners.set(ownerKey, owner);
  }

  const facts = new Map<string, WorkspaceSessionLiveFacts>();
  for (const [key, owner] of owners) {
    // Members of a parent cycle own each other, so none of them is a root.
    if (resolveWorkspaceSessionOwnerKey(sessions, key) !== key) continue;
    facts.set(key, {
      activityState: getAgentSessionActivityState({
        status: owner.status,
        hasPendingInput: owner.pendingQuestion || owner.pendingPermission,
      }),
      pendingQuestion: owner.pendingQuestion,
      pendingPermission: owner.pendingPermission,
      lastActivityAt: owner.lastActivityAt,
      fault: owner.fault,
      statusUnavailableReason: owner.statusUnavailableReason,
    });
  }
  return facts;
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
    if (!isArchivedBranch(sessions, archivedSessionKeys, key)) {
      counted.set(key, session);
    }
  }

  let inputRequired = false;
  let error = false;
  let active = false;
  for (const { activityState } of foldWorkspaceSessionLiveFacts(counted, new Map()).values()) {
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
