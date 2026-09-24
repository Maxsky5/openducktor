import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { HostLifecycleLogger } from "../host-lifecycle";
import { createLiveSessionRootRefsReader } from "./live-session-root-refs";
import { createLiveSessionFaultLogger } from "./node-host-lifecycle-logger";
import { createLiveSessionPublisher } from "./runtime-lifecycle-publisher";

type Input = Omit<
  Parameters<typeof createAgentSessionLiveStateService>[0],
  "adapterRegistry" | "readSessionRootRefs" | "faultLog" | "publish"
> &
  Parameters<typeof createLiveSessionRootRefsReader>[0] & {
    readonly eventBus: HostEventBusPort | undefined;
    readonly lifecycleLogger: HostLifecycleLogger;
  };

export const createNodeAgentSessionLiveState = ({
  eventBus,
  lifecycleLogger,
  ...dependencies
}: Input) => {
  const liveSessionAdapterRegistry = createLiveSessionAdapterRegistry();
  return {
    liveSessionAdapterRegistry,
    liveState: createAgentSessionLiveStateService({
      ...dependencies,
      adapterRegistry: liveSessionAdapterRegistry,
      readSessionRootRefs: createLiveSessionRootRefsReader(dependencies),
      faultLog: createLiveSessionFaultLogger(lifecycleLogger),
      publish: createLiveSessionPublisher(eventBus),
    }),
  };
};
