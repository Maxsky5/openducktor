import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";

type AgentSessionLiveAttachment = {
  accept: (envelope: AgentSessionLiveEnvelope) => void;
  restart: () => void;
};

const envelopeRepoPath = (envelope: AgentSessionLiveEnvelope): string => {
  switch (envelope.type) {
    case "snapshot":
    case "transcript_gap":
    case "fault":
      return envelope.repoPath;
    case "session_upsert":
      return envelope.session.ref.repoPath;
    case "session_removed":
      return envelope.ref.repoPath;
    case "transcript_event":
      return envelope.event.sessionRef.repoPath;
    case "catalog_invalidated":
    case "slash_command_catalog_updated":
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
          listener(envelope);
          return;
        }
        awaitingSnapshot = false;
        const buffered = pending;
        pending = [];
        listener(envelope);
        for (const bufferedEnvelope of buffered) {
          if (
            bufferedEnvelope.type === "session_upsert" ||
            bufferedEnvelope.type === "session_removed"
          ) {
            continue;
          }
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
