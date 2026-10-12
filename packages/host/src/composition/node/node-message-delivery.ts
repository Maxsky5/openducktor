import { resolveRuntimeSteeringAvailability } from "@openducktor/core";
import { Effect, Exit, FiberSet, Scope } from "effect";
import {
  type AgentMessageDeliveryDependencies,
  createAgentMessageDeliveryService,
} from "../../application/agent-sessions/agent-message-delivery-service";
import {
  causeMessage,
  HostOperationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { resolveRuntimeDescriptor } from "../../application/runtimes/runtime-request-resolution";
import { createLiveSessionPublisher } from "./runtime-lifecycle-publisher";

/** Creates queued message delivery with a scope that owns its background deliveries. */
export const createNodeMessageDelivery = ({
  eventBus,
  onBackgroundFailure,
  runtimeRegistry,
  runtimeDefinitions,
  ...dependencies
}: Pick<AgentMessageDeliveryDependencies, "canonicalizeRepoPath" | "prepare" | "send"> & {
  readonly eventBus: HostEventBusPort | undefined;
  readonly onBackgroundFailure: (
    failure: HostOperationErrorAggregate,
  ) => Effect.Effect<void, never>;
  readonly runtimeRegistry: Pick<RuntimeRegistryPort, "status">;
  readonly runtimeDefinitions: RuntimeDefinitionsService;
}) => {
  // Owns background deliveries. Closing the scope interrupts them and waits.
  const deliveriesScope = Scope.makeUnsafe();
  const deliveries = Effect.runSync(Scope.provide(FiberSet.make<void>(), deliveriesScope));
  const service = createAgentMessageDeliveryService({
    ...dependencies,
    steeringAvailability: (kind) =>
      Effect.all([
        resolveRuntimeDescriptor(runtimeDefinitions, kind),
        runtimeRegistry.status(kind),
      ]).pipe(
        Effect.map(([descriptor, status]) =>
          resolveRuntimeSteeringAvailability(descriptor, status.version),
        ),
      ),
    publish: createLiveSessionPublisher(eventBus),
    runInBackground: (effect) => {
      Effect.runSync(
        FiberSet.run(
          deliveries,
          effect.pipe(
            Effect.catchCause((cause) =>
              onBackgroundFailure(
                new HostOperationError({
                  operation: "agent-message-delivery.deliver",
                  message: `Queued message delivery stopped unexpectedly: ${causeMessage(cause)}`,
                  cause,
                }),
              ),
            ),
          ),
        ),
      );
    },
    now: () => new Date().toISOString(),
  });
  return {
    ...service,
    /** Stops background deliveries before the runtimes that they send to stop. */
    shutdown: () => Scope.close(deliveriesScope, Exit.void),
  };
};
