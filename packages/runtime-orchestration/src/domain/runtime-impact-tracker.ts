import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  RuntimeKind,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { reviewedSession } from "./runtime-impact-review";

/**
 * Follows live-session events and tells which runtime kinds changed their reviewed sessions: a
 * session joined, left, or changed a reviewed field. Transcript and context updates change
 * nothing. An open restart or settings review reads its impact again for these kinds.
 */
export const createRuntimeImpactTracker = () => {
  const reviewed = new Map<string, { ref: AgentSessionLiveRef; fields: string }>();
  return (envelope: AgentSessionLiveEnvelope): RuntimeKind[] => {
    const changed = new Set<RuntimeKind>();
    const put = (snapshot: AgentSessionLiveSnapshot) => {
      const key = agentSessionRefKey(snapshot.ref);
      const fields = JSON.stringify(reviewedSession(snapshot));
      if (reviewed.get(key)?.fields !== fields) changed.add(snapshot.ref.runtimeKind);
      reviewed.set(key, { ref: snapshot.ref, fields });
    };
    const drop = (ref: AgentSessionLiveRef) => {
      if (reviewed.delete(agentSessionRefKey(ref))) changed.add(ref.runtimeKind);
    };
    if (envelope.type === "session_upsert") put(envelope.session);
    if (envelope.type === "session_removed") drop(envelope.ref);
    if (envelope.type === "snapshot") {
      // A repository snapshot replaces every session of that repository.
      const listed = new Set(envelope.sessions.map((session) => agentSessionRefKey(session.ref)));
      for (const [key, entry] of reviewed) {
        if (entry.ref.repoPath === envelope.repoPath && !listed.has(key)) drop(entry.ref);
      }
      for (const session of envelope.sessions) put(session);
    }
    return [...changed];
  };
};
