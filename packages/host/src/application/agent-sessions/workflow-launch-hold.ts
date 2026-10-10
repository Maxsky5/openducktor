import type { AgentSessionLiveRef, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveRegistration,
} from "../../ports/agent-session-live-adapter-port";

type TranscriptChange = Extract<AgentSessionLiveAdapterChange, { type: "transcript_event" }>;
type HeldLaunch = {
  binding: AgentSessionLiveRegistration;
  deferredIdle: Map<"session_idle" | "session_status" | "session_finished", TranscriptChange>;
};

/**
 * Idle startup events must not end the first turn or hide a pending input. Errors pass through.
 * The launch releases the hold when it settles and then publishes the current snapshot.
 */
export const createWorkflowLaunchHold = () => {
  const holds = new Map<string, HeldLaunch>();
  return {
    acquire: (ref: AgentSessionLiveRef, binding: AgentSessionLiveRegistration): void => {
      holds.set(agentSessionRefKey(ref), { binding, deferredIdle: new Map() });
    },
    release: (ref: AgentSessionLiveRef): readonly TranscriptChange[] | undefined => {
      const key = agentSessionRefKey(ref);
      const held = holds.get(key);
      holds.delete(key);
      if (!held) return undefined;
      // Apply the final stop reason before idle signals can produce a completion notice.
      const finished = held.deferredIdle.get("session_finished");
      held.deferredIdle.delete("session_finished");
      return [...(finished ? [finished] : []), ...held.deferredIdle.values()];
    },
    releaseRuntime: (binding: AgentSessionLiveRegistration): void => {
      for (const [key, held] of holds) if (held.binding === binding) holds.delete(key);
    },
    projectChange: (
      change: AgentSessionLiveAdapterChange,
    ): AgentSessionLiveAdapterChange | null => {
      if (change.type !== "transcript_event") return change;
      const event = change.event;
      const key = agentSessionRefKey(event.sessionRef);
      const held = holds.get(key);
      if (!held) return change;
      if (
        event.type === "session_idle" ||
        event.type === "session_finished" ||
        (event.type === "session_status" && event.status.type === "idle")
      ) {
        const previous = held.deferredIdle.get(event.type);
        // Keep completed-turn metadata when a later status repeats the same idle state.
        if (
          !(
            event.type === "session_idle" &&
            event.turnCompleted !== true &&
            previous?.event.type === "session_idle" &&
            previous.event.turnCompleted === true
          )
        )
          held.deferredIdle.set(event.type, change);
        return null;
      }
      return change;
    },
    project: (snapshot: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot =>
      holds.has(agentSessionRefKey(snapshot.ref)) && snapshot.activity === "idle"
        ? { ...snapshot, activity: "running" }
        : snapshot,
  };
};
