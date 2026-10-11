import {
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveSnapshotEnvelope,
  isAgentSessionLiveStateEnvelope,
} from "@openducktor/contracts";

type AgentSessionLiveAttachment = {
  accept: (envelope: AgentSessionLiveEnvelope) => void;
  /** Installs a host snapshot, then delivers the changes it does not cover. */
  install: (snapshot: AgentSessionLiveSnapshotEnvelope) => void;
  /** Drops held changes and holds new ones until the next `install`. */
  restart: () => void;
};

export const envelopeRepoPath = (envelope: AgentSessionLiveEnvelope): string => {
  switch (envelope.type) {
    case "task_session_records_updated":
    case "snapshot":
    case "fault":
      return envelope.repoPath;
    case "session_upsert":
      return envelope.session.ref.repoPath;
    case "session_removed":
      return envelope.ref.repoPath;
    case "transcript_event":
      return envelope.event.sessionRef.repoPath;
    case "catalog_invalidated":
    case "runtime_notice":
    case "slash_command_catalog_updated":
      return envelope.scope.repoPath;
  }
};

/**
 * Subscribe first, then install the snapshot that `agent_session_live_attach` returns. The
 * snapshot covers every state change up to its sequence, so older state changes are dropped. An
 * older record update keeps its durable records without its live session. Transcript and other
 * changes are delivered in stream order.
 */
export const createAgentSessionLiveAttachment = (
  repoPath: string,
  listener: (envelope: AgentSessionLiveEnvelope) => void,
): AgentSessionLiveAttachment => {
  let awaitingSnapshot = true;
  let pending: AgentSessionLiveEnvelope[] = [];
  let coveredSequence = -1;

  const deliver = (envelope: AgentSessionLiveEnvelope): void => {
    if (
      isAgentSessionLiveStateEnvelope(envelope) &&
      envelope.sequence !== undefined &&
      envelope.sequence <= coveredSequence
    ) {
      // Durable records still apply. Only their live session is older than the snapshot.
      if (envelope.type === "task_session_records_updated") {
        const { liveSession: _covered, ...records } = envelope;
        listener(records);
      }
      return;
    }
    listener(envelope);
  };

  return {
    accept: (envelope) => {
      if (envelopeRepoPath(envelope) !== repoPath) {
        return;
      }
      if (awaitingSnapshot && envelope.type !== "fault" && envelope.type !== "runtime_notice") {
        pending.push(envelope);
        return;
      }
      deliver(envelope);
    },
    install: (snapshot) => {
      if (snapshot.sequence === undefined) {
        throw new Error(
          `The live-session snapshot of '${repoPath}' has no host sequence. Restart the host.`,
        );
      }
      awaitingSnapshot = false;
      // A new host starts a new sequence, so the latest snapshot sets the bound.
      coveredSequence = snapshot.sequence;
      const buffered = pending;
      pending = [];
      listener({ ...snapshot, isConnectionSnapshot: true });
      for (const envelope of buffered) deliver(envelope);
    },
    restart: () => {
      // The next snapshot and history reload replace everything received before the restart.
      awaitingSnapshot = true;
      pending = [];
    },
  };
};
