import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";

type AgentSessionLiveAttachment = {
  accept: (envelope: AgentSessionLiveEnvelope) => void;
  restart: () => void;
};

const envelopeRepoPath = (envelope: AgentSessionLiveEnvelope): string => {
  switch (envelope.type) {
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
      return envelope.scope.repoPath;
  }
};

export const createAgentSessionLiveAttachment = (
  repoPath: string,
  listener: (envelope: AgentSessionLiveEnvelope) => void,
): AgentSessionLiveAttachment => {
  let awaitingSnapshot = true;
  let pending: AgentSessionLiveEnvelope[] = [];

  return {
    accept: (envelope) => {
      if (envelopeRepoPath(envelope) !== repoPath) {
        return;
      }
      if (envelope.type === "fault") {
        listener(envelope);
        return;
      }
      if (envelope.type === "snapshot") {
        if (!awaitingSnapshot) {
          return;
        }
        awaitingSnapshot = false;
        const buffered = pending;
        pending = [];
        listener(envelope);
        for (const bufferedEnvelope of buffered) {
          listener(bufferedEnvelope);
        }
        return;
      }
      if (awaitingSnapshot) {
        pending.push(envelope);
        return;
      }
      listener(envelope);
    },
    restart: () => {
      if (!awaitingSnapshot) {
        pending = [];
      }
      awaitingSnapshot = true;
    },
  };
};
