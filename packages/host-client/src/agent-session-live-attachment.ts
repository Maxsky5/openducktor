import {
  agentSessionLiveEnvelopeRepoPath,
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveSnapshotEnvelope,
  isAgentSessionLiveStateEnvelope,
} from "@openducktor/contracts";

type AgentSessionLiveAttachment = {
  accept: (envelope: AgentSessionLiveEnvelope) => void;
  /** Installs a host snapshot, then delivers the changes it does not cover. */
  install: (snapshot: AgentSessionLiveSnapshotEnvelope) => void;
  /**
   * Holds new changes, as when the connection drops. A reconnect then decides: `resume` after a
   * replay that has every missed change of the repository, `restart` after a gap.
   */
  suspend: () => void;
  /** Delivers the held changes in order and the next ones at once. */
  resume: () => void;
  /** Drops held changes and holds new ones until the next `install`. */
  restart: () => void;
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
  let suspended = false;
  let pending: AgentSessionLiveEnvelope[] = [];
  let coveredSequence = -1;
  let historyReplayGap = false;

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
      if (agentSessionLiveEnvelopeRepoPath(envelope) !== repoPath) {
        return;
      }
      if (
        (awaitingSnapshot || suspended) &&
        envelope.type !== "fault" &&
        envelope.type !== "runtime_notice"
      ) {
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
      suspended = false;
      // A new host starts a new sequence, so the latest snapshot sets the bound.
      coveredSequence = snapshot.sequence;
      const buffered = pending;
      pending = [];
      const connected: AgentSessionLiveSnapshotEnvelope = {
        ...snapshot,
        isConnectionSnapshot: true,
      };
      if (historyReplayGap) connected.historyReplayGap = true;
      listener(connected);
      historyReplayGap = false;
      for (const envelope of buffered) deliver(envelope);
    },
    suspend: () => {
      suspended = true;
    },
    resume: () => {
      suspended = false;
      // Before the first snapshot, the held changes wait for it.
      if (awaitingSnapshot) return;
      const held = pending;
      pending = [];
      for (const envelope of held) deliver(envelope);
    },
    restart: () => {
      // The next snapshot and history reload replace everything received before the restart.
      awaitingSnapshot = true;
      suspended = false;
      pending = [];
      historyReplayGap = true;
    },
  };
};
