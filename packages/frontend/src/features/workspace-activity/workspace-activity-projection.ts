import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { projectSessionTranscriptActivity } from "@/state/operations/agent-orchestrator/session-read-model/agent-session-live-activity";
import { projectSessionSnapshotActivity } from "@/state/operations/agent-orchestrator/session-read-model/agent-session-live-projection";
import type { WorkspaceActivitySession } from "./workspace-activity-state";

export type WorkspaceActivityProjection = {
  sessions: ReadonlyMap<string, WorkspaceActivitySession>;
  /** True after the stream delivered its first authoritative snapshot. */
  hasSnapshot: boolean;
  unavailableReason: string | null;
};

export const emptyWorkspaceActivityProjection = (): WorkspaceActivityProjection => ({
  sessions: new Map(),
  hasSnapshot: false,
  unavailableReason: null,
});

const sessionKey = (ref: AgentSessionLiveRef): string =>
  agentSessionIdentityKey({
    externalSessionId: ref.externalSessionId,
    runtimeKind: ref.runtimeKind,
    workingDirectory: ref.workingDirectory,
  });

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
  const key = sessionKey(snapshot.ref);
  const activity = projectSessionSnapshotActivity(
    current ?? { status: "idle", runtimeStatusMessage: null },
    snapshot,
  );
  return {
    key,
    parentKey: parentSessionKey(snapshot),
    ...activity,
    stopRequestedAt: null,
    pendingApprovals: snapshot.pendingApprovals,
    pendingQuestions: snapshot.pendingQuestions,
  };
};

const faultReason = (envelope: Extract<AgentSessionLiveEnvelope, { type: "fault" }>): string =>
  envelope.operation ? `${envelope.message} (during ${envelope.operation})` : envelope.message;

const withUnavailableReason = (
  current: WorkspaceActivityProjection,
  reason: string,
): WorkspaceActivityProjection =>
  current.unavailableReason === reason ? current : { ...current, unavailableReason: reason };

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
      const key = sessionKey(snapshot.ref);
      sessions.set(key, toActivitySession(snapshot, current.sessions.get(key)));
    }
    return { sessions, hasSnapshot: true, unavailableReason: null };
  }

  if (envelope.type === "session_upsert") {
    const key = sessionKey(envelope.session.ref);
    const sessions = new Map(current.sessions);
    sessions.set(key, toActivitySession(envelope.session, current.sessions.get(key)));
    return { ...current, sessions };
  }

  if (envelope.type === "session_removed") {
    const key = sessionKey(envelope.ref);
    if (!current.sessions.has(key)) {
      return current;
    }
    const sessions = new Map(current.sessions);
    sessions.delete(key);
    return { ...current, sessions };
  }

  if (envelope.type === "transcript_event") {
    const key = sessionKey(envelope.event.sessionRef);
    const session = current.sessions.get(key);
    if (!session) {
      return current;
    }
    const next = projectSessionTranscriptActivity(session, envelope.event);
    if (next === session) {
      return current;
    }
    const sessions = new Map(current.sessions);
    sessions.set(key, next);
    return { ...current, sessions };
  }

  if (envelope.type === "fault") {
    if (envelope.ref) {
      return current;
    }
    return withUnavailableReason(current, faultReason(envelope));
  }

  if (envelope.type === "transcript_gap") {
    return withUnavailableReason(current, envelope.message);
  }

  return current;
};
