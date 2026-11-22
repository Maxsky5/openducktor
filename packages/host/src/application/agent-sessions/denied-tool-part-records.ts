import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentToolPart,
} from "@openducktor/contracts";
import { type AgentSessionHistoryMessage, agentSessionRefKey } from "@openducktor/core";

type DeniedToolPart = { readonly part: AgentToolPart; readonly timestamp: string };

/** The assistant message of a denied call that the history does not have. */
const ownMessage = (part: AgentToolPart, timestamp: string): AgentSessionHistoryMessage => ({
  role: "assistant",
  messageId: part.messageId,
  timestamp,
  text: "",
  parts: [part],
});

export type DeniedToolPartRecords = ReturnType<typeof createDeniedToolPartRecords>;

/**
 * Keeps in memory the last published tool part with `denial` for each call of a live session.
 * Codex and OpenCode history has no denial data, so a history read adds these parts while the
 * host runs. A removed session drops its parts, and a retracted message drops the parts in it.
 */
export const createDeniedToolPartRecords = () => {
  const sessions = new Map<string, Map<string, DeniedToolPart>>();
  return {
    observe: (envelope: AgentSessionLiveEnvelope): void => {
      if (envelope.type === "session_removed") {
        sessions.delete(agentSessionRefKey(envelope.ref));
        return;
      }
      if (envelope.type !== "transcript_event") return;
      const { event } = envelope;
      if (event.type === "transcript_retracted") {
        // A revert removes the call from the runtime history, so its row must not come back.
        const parts = sessions.get(agentSessionRefKey(event.sessionRef));
        const retracted = new Set(event.messageIds);
        for (const [callId, { part }] of parts ?? [])
          if (retracted.has(part.messageId)) parts?.delete(callId);
        return;
      }
      if (event.type !== "assistant_part" || event.part.kind !== "tool" || !event.part.denial)
        return;
      const key = agentSessionRefKey(event.sessionRef);
      const parts = sessions.get(key) ?? new Map<string, DeniedToolPart>();
      parts.set(event.part.callId, { part: event.part, timestamp: event.timestamp });
      sessions.set(key, parts);
    },
    /**
     * Sets the recorded `denial` on each matching tool part of the history. A recorded part with no
     * matching call, such as a Codex network review, becomes its own assistant message at its time.
     * A limited history skips such a part when it is older than the first loaded message.
     */
    apply: (
      ref: AgentSessionLiveRef,
      history: AgentSessionHistoryMessage[],
      limited: boolean,
    ): AgentSessionHistoryMessage[] => {
      const recorded = sessions.get(agentSessionRefKey(ref));
      if (!recorded) return history;
      const matched = new Set<string>();
      const merged: AgentSessionHistoryMessage[] = [];
      for (const message of history) {
        if (
          message.role === "system" ||
          !message.parts.some((part) => part.kind === "tool" && recorded.has(part.callId))
        ) {
          merged.push(message);
          continue;
        }
        const parts = message.parts.map((part) => {
          if (part.kind !== "tool") return part;
          const record = recorded.get(part.callId);
          if (!record) return part;
          matched.add(part.callId);
          // The live denial keeps the reason that the user saw, so it wins over history.
          return { ...part, denial: record.part.denial };
        });
        merged.push({ ...message, parts });
      }
      const unmatched = [...recorded.entries()].filter(([callId]) => !matched.has(callId));
      if (unmatched.length === 0) return merged;
      const times = merged.map((message) => Date.parse(message.timestamp));
      const firstTime = times[0];
      for (const [, { part, timestamp }] of unmatched) {
        const time = Date.parse(timestamp);
        if (limited && firstTime !== undefined && time < firstTime) continue;
        const later = times.findIndex((messageTime) => messageTime > time);
        const at = later === -1 ? merged.length : later;
        merged.splice(at, 0, ownMessage(part, timestamp));
        times.splice(at, 0, time);
      }
      return merged;
    },
  };
};
