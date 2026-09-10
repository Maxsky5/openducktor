import { Effect } from "effect";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import type { CreateRuntimeRegistryInput } from "../../adapters/runtimes/runtime-registry";
import { HostOperationError, HostResourceError } from "../../effect/host-errors";
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

export const createRuntimeLifecyclePublisher =
  (
    eventBus: HostEventBusPort | undefined,
  ): NonNullable<CreateRuntimeRegistryInput["onRuntimeChanged"]> =>
  (runtime, state) =>
    Effect.try({
      try: () => {
        createLiveSessionPublisher(eventBus)({
          type: "runtime_changed",
          scope: { repoPath: runtime.repoPath, runtimeKind: runtime.kind },
          state,
        });
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "runtime.publish-change",
          message: "Cannot publish the runtime change. Check the host event bus.",
          cause,
        }),
    });
