import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { projectSessionTranscriptActivity } from "@/state/operations/agent-orchestrator/session-read-model/agent-session-live-activity";
import { projectSessionSnapshotActivity } from "@/state/operations/agent-orchestrator/session-read-model/agent-session-live-projection";
import type { WorkspaceActivitySession, WorkspaceSessionFault } from "./workspace-activity-state";

export type WorkspaceActivityProjection = {
  sessions: ReadonlyMap<string, WorkspaceActivitySession>;
  /** Session-scoped observation faults, keyed by session identity key. */
  faults: ReadonlyMap<string, WorkspaceSessionFault>;
  /** True after the stream delivered its first authoritative snapshot. */
  hasSnapshot: boolean;
  unavailableReason: string | null;
};

export const emptyWorkspaceActivityProjection = (): WorkspaceActivityProjection => ({
  sessions: new Map(),
  faults: new Map(),
  hasSnapshot: false,
  unavailableReason: null,
});

/**
 * Apply one live envelope to the reduced per-workspace projection.
 *
 * Returns the same reference when the envelope changes no badge input.
 */
export const applyWorkspaceActivityEnvelope = (
  current: WorkspaceActivityProjection,
  envelope: AgentSessionLiveEnvelope,
): WorkspaceActivityProjection => {
  if (envelope.type === "snapshot") {
    const sessions = new Map<string, WorkspaceActivitySession>();
    for (const snapshot of envelope.sessions) {
      const key = agentSessionIdentityKey(snapshot.ref);
      sessions.set(key, toActivitySession(snapshot, current.sessions.get(key)));
    }
    return { sessions, faults: new Map(), hasSnapshot: true, unavailableReason: null };
  }

  if (envelope.type === "session_upsert") {
    const key = agentSessionIdentityKey(envelope.session.ref);
    const sessions = new Map(current.sessions);
    sessions.set(key, toActivitySession(envelope.session, current.sessions.get(key)));
    return { ...current, sessions, faults: withoutFault(current.faults, key) };
  }

  if (envelope.type === "session_removed") {
    const key = agentSessionIdentityKey(envelope.ref);
    const faults = withoutFault(current.faults, key);
    if (!current.sessions.has(key)) {
      return faults === current.faults ? current : { ...current, faults };
    }
    const sessions = new Map(current.sessions);
    sessions.delete(key);
    return { ...current, sessions, faults };
  }

  if (envelope.type === "transcript_event") {
    if (envelope.provenance === "baseline") return current;
    const key = agentSessionIdentityKey(envelope.event.sessionRef);
    const session = current.sessions.get(key);
    if (!session) {
      return current;
    }
    const next = projectSessionTranscriptActivity(session, envelope.event);
    // Terminal events can clear pending input before their next snapshot arrives.
    if (
      next.preview &&
      (next.pendingApprovals !== session.pendingApprovals ||
        next.pendingQuestions !== session.pendingQuestions)
    ) {
      const approvals = new Set(next.pendingApprovals);
      const questions = new Set(next.pendingQuestions);
      next.preview = {
        ...next.preview,
        pendingApprovals: next.preview.pendingApprovals.filter((request) => approvals.has(request)),
        pendingQuestions: next.preview.pendingQuestions.filter((request) => questions.has(request)),
      };
    }
    const faults = withoutFault(current.faults, key);
    if (next === session) {
      return faults === current.faults ? current : { ...current, faults };
    }
    const sessions = new Map(current.sessions);
    sessions.set(key, next);
    return { ...current, sessions, faults };
  }

  if (envelope.type === "fault") {
    if (envelope.ref) {
      const key = agentSessionIdentityKey(envelope.ref);
      const fault = {
        message: faultReason(envelope),
        statusUnavailable: envelope.statusUnavailable === true,
      };
      const known = current.faults.get(key);
      if (known?.message === fault.message && known.statusUnavailable === fault.statusUnavailable) {
        return current;
      }
      const faults = new Map(current.faults);
      faults.set(key, fault);
      return { ...current, faults };
    }
    return withUnavailableReason(current, faultReason(envelope));
  }

  return current;
};

const parentSessionKey = (snapshot: AgentSessionLiveSnapshot): string | null =>
  snapshot.parentExternalSessionId === undefined
    ? null
    : agentSessionIdentityKey({
        externalSessionId: snapshot.parentExternalSessionId,
        runtimeKind: snapshot.ref.runtimeKind,
        workingDirectory: snapshot.ref.workingDirectory,
      });

const toActivitySession = (
  snapshot: AgentSessionLiveSnapshot,
  current: WorkspaceActivitySession | undefined,
): WorkspaceActivitySession => {
  const key = agentSessionIdentityKey(snapshot.ref);
  const activity = projectSessionSnapshotActivity(
    current ?? { status: "idle", runtimeStatusMessage: null },
    snapshot,
  );
  const preview: NonNullable<WorkspaceActivitySession["preview"]> = {
    ref: snapshot.ref,
    title: snapshot.title,
    pendingApprovals: snapshot.pendingApprovals,
    pendingQuestions: snapshot.pendingQuestions,
  };
  if (snapshot.model !== undefined) preview.model = snapshot.model;
  if (snapshot.repositoryScope !== undefined) preview.repositoryScope = snapshot.repositoryScope;
  return {
    key,
    parentKey: parentSessionKey(snapshot),
    ...activity,
    stopRequestedAt: null,
    pendingApprovals: snapshot.pendingApprovals,
    pendingQuestions: snapshot.pendingQuestions,
    // Only a snapshot sets or clears it, so transcript events keep a failed status read.
    statusUnavailableReason: snapshot.statusUnavailableReason ?? null,
    preview,
  };
};

const withoutFault = (
  faults: ReadonlyMap<string, WorkspaceSessionFault>,
  key: string,
): ReadonlyMap<string, WorkspaceSessionFault> => {
  if (!faults.has(key)) {
    return faults;
  }
  const next = new Map(faults);
  next.delete(key);
  return next;
};

const faultReason = (envelope: Extract<AgentSessionLiveEnvelope, { type: "fault" }>): string =>
  envelope.operation ? `${envelope.message} (during ${envelope.operation})` : envelope.message;

const withUnavailableReason = (
  current: WorkspaceActivityProjection,
  reason: string,
): WorkspaceActivityProjection =>
  current.unavailableReason === reason ? current : { ...current, unavailableReason: reason };
