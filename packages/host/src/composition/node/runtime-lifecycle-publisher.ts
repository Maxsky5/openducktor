import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  HostRuntimeStatus,
  RuntimeKind,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { reviewedSession } from "../../application/runtimes/runtime-impact-confirmations";
import { HostResourceError } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";

export const createLiveSessionPublisher =
  (eventBus: HostEventBusPort | undefined) =>
  (envelope: AgentSessionLiveEnvelope): void => {
    if (!eventBus) {
      throw new HostResourceError({
        resource: "host-event-bus",
        operation: "agent-session-live.publish",
        message: "Live agent-session events require a configured host event bus.",
      });
    }
    eventBus.publish({ channel: "openducktor://agent-session-live-event", payload: envelope });
  };

/**
 * Sends `runtime_impact_changed` on the host-level channel when a session joins, leaves, or
 * changes a reviewed field. Session events are repository scoped, but restart and settings
 * reviews cover every workspace. Transcript and context updates send nothing.
 */
export const createRuntimeImpactSignal = (eventBus: HostEventBusPort) => {
  const reviewed = new Map<string, { ref: AgentSessionLiveRef; fields: string }>();
  return (envelope: AgentSessionLiveEnvelope): void => {
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
    if (changed.size === 0) return;
    eventBus.publish({
      channel: "openducktor://runtime-changed",
      payload: { type: "runtime_impact_changed", runtimeKinds: [...changed] },
    });
  };
};

/** Publishes host runtime status on the host-level channel. No repository filter applies. */
export const createRuntimeStatusPublisher =
  (eventBus: HostEventBusPort, hostInstanceId: string) =>
  (status: HostRuntimeStatus): void => {
    eventBus.publish({
      channel: "openducktor://runtime-changed",
      payload: { type: "runtime_changed", hostInstanceId, status },
    });
  };
