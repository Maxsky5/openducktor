import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect } from "effect";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import type { SessionLaunchControls } from "../../application/agent-sessions/session-launch-types";

/** Stop cancels launches that target the session, so a launch cannot send to it afterwards. */
export const createNodeSessionLaunchControls = <
  Commands extends {
    stopSession: (
      ref: AgentSessionLiveRef,
      options?: { onValidated: (ref: AgentSessionLiveRef) => void },
    ) => ReturnType<SessionLaunchRuntimePort["stopSession"]>;
  },
>(
  commands: Commands,
  services: SessionLaunchControls[],
) => ({
  commands: {
    ...commands,
    stopSession: (ref: AgentSessionLiveRef) =>
      commands.stopSession(ref, {
        onValidated: (canonical) => {
          for (const service of services) service.cancelSessionLaunches(canonical);
        },
      }),
  },
  shutdown: () => Effect.forEach(services, (service) => service.shutdown(), { discard: true }),
});
