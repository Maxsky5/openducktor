import type {
  AgentSessionDeniedAction,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import type { ClaudeLiveEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import { liveSessionRefKey } from "./live-session-ref";

export type ClaudeDeniedActionBeginOutcome =
  | "accepted"
  | "missing"
  | Exclude<AgentSessionDeniedAction["state"], "available">;

/** A transcript event with the denial of its call, and whether it offered a new Allow entry. */
type ClaudeDeniedEvent<Event extends ClaudeLiveEvent> = {
  readonly event: Event;
  readonly offered: boolean;
};

/**
 * The Allow state of the denied calls that the user can allow, by session and call. It only keeps
 * entries; the live session state commits the snapshots that show them.
 */
export const createClaudeDeniedActions = () => {
  const entriesByRef = new Map<string, Map<string, AgentSessionDeniedAction>>();

  return {
    project: (key: string, snapshot: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot => {
      const entries = entriesByRef.get(key);
      if (entries?.size) return { ...snapshot, deniedActions: [...entries.values()] };
      if (snapshot.deniedActions === undefined) return snapshot;
      const { deniedActions: _previous, ...rest } = snapshot;
      return rest;
    },
    /**
     * Every failed emission of a denied call carries its denial while the session lives. The
     * first one of a main-session denial that the user can allow offers Allow.
     */
    applyEvent: <Event extends ClaudeLiveEvent>(
      session: ClaudeSessionContext,
      ref: AgentSessionLiveRef,
      event: Event,
    ): ClaudeDeniedEvent<Event> => {
      if (event.type !== "assistant_part" || event.part.kind !== "tool")
        return { event, offered: false };
      const record = session.toolDenialsByCallId.get(event.part.callId);
      if (!record || event.part.status !== "error") return { event, offered: false };
      const denied = { ...event, part: { ...event.part, denial: record.denial } };
      const key = liveSessionRefKey(ref);
      const entries = entriesByRef.get(key) ?? new Map<string, AgentSessionDeniedAction>();
      const offers =
        record.allow !== undefined &&
        ref.externalSessionId === session.externalSessionId &&
        !entries.has(event.part.callId);
      if (!offers) return { event: denied, offered: false };
      entries.set(event.part.callId, { callId: event.part.callId, state: "available" });
      entriesByRef.set(key, entries);
      return { event: denied, offered: true };
    },
    /** Moves an `available` entry to `sending`. Any other outcome blocks the request. */
    begin: (ref: AgentSessionLiveRef, callId: string): ClaudeDeniedActionBeginOutcome => {
      const entries = entriesByRef.get(liveSessionRefKey(ref));
      const entry = entries?.get(callId);
      if (!entries || !entry) return "missing";
      if (entry.state !== "available") return entry.state;
      entries.set(callId, { callId, state: "sending" });
      return "accepted";
    },
    /**
     * Ends a request: `allowed` after success, or `available` with the failure. Returns false when
     * the session no longer has the entry.
     */
    settle: (ref: AgentSessionLiveRef, callId: string, failure?: string): boolean => {
      const entries = entriesByRef.get(liveSessionRefKey(ref));
      if (!entries?.has(callId)) return false;
      entries.set(
        callId,
        failure === undefined
          ? { callId, state: "allowed" }
          : { callId, state: "available", failure },
      );
      return true;
    },
    remove: (key: string) => entriesByRef.delete(key),
    clear: () => entriesByRef.clear(),
  };
};
