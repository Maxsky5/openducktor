import type {
  AgentSessionLiveEnvelope,
  HostMcpBridgeStatus,
  HostRuntimeStatus,
} from "@openducktor/contracts";
import { createRuntimeImpactTracker } from "@openducktor/runtime-orchestration";
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
  const changedKinds = createRuntimeImpactTracker();
  return (envelope: AgentSessionLiveEnvelope): void => {
    const runtimeKinds = changedKinds(envelope);
    if (runtimeKinds.length === 0) return;
    eventBus.publish({
      channel: "openducktor://runtime-changed",
      payload: { type: "runtime_impact_changed", runtimeKinds },
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

/** Publishes the MCP host bridge status on the host-level runtime channel. */
export const createMcpBridgeStatusPublisher =
  (eventBus: HostEventBusPort, hostInstanceId: string) =>
  (status: HostMcpBridgeStatus): void => {
    eventBus.publish({
      channel: "openducktor://runtime-changed",
      payload: { type: "mcp_bridge_changed", hostInstanceId, status },
    });
  };
