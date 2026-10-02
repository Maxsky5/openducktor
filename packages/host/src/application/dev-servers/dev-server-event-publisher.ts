import type { DevServerEvent } from "@openducktor/contracts";
import type { HostEventBusPort } from "../../events/host-event-bus";
import { createDevServerEventEnvelope, type DevServerGroupRuntime } from "./dev-server-state";

export const createDevServerEventPublisher = (eventBus?: HostEventBusPort) => {
  const publish = (event: DevServerEvent): void =>
    eventBus?.publish(createDevServerEventEnvelope(event));
  const publishSnapshot = (runtime: DevServerGroupRuntime): void =>
    publish({ type: "snapshot", state: runtime.state });
  return { publish, publishSnapshot };
};
