import { resolveRuntimeSteeringAvailability } from "@openducktor/core";
import { agentMessageSubmitInputSchema } from "@openducktor/contracts";
import { createHash } from "node:crypto";
import { Effect, Exit, Fiber, FiberSet, Scope } from "effect";
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
}: Pick<
  AgentMessageDeliveryDependencies,
  | "canonicalizeRepoPath"
  | "prepare"
  | "send"
  | "runOperation"
  | "prepareQueueResume"
  | "commitQueueResume"
> & {
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
  let closing = false;
  const supervise = <A, E>(work: Effect.Effect<A, E>) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (closing)
          return yield* new HostOperationError({
            operation: "message-delivery.admit",
            message: "The host is shutting down. Reopen the application before submitting work.",
          });
        const worker = yield* Effect.forkIn(work, deliveriesScope, { uninterruptible: false });
        return yield* restore(Fiber.join(worker));
      }),
    );
  const runBackground = (
    effect: Effect.Effect<void, import("../../effect/host-errors").HostError>,
  ) => {
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
  };
  const service = createAgentMessageDeliveryService({
    ...dependencies,
    submissionFingerprint: (input) =>
      createHash("sha256")
        .update(JSON.stringify(agentMessageSubmitInputSchema.parse(input)))
        .digest("hex"),
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
    runInBackground: runBackground,
    now: () => new Date().toISOString(),
  });
  return {
    ...service,
    runBackground,
    submit: (...args: Parameters<typeof service.submit>) => supervise(service.submit(...args)),
    manage: (input: Parameters<typeof service.manage>[0]) => supervise(service.manage(input)),
    /** Stops background deliveries before the runtimes that they send to stop. */
    shutdown: () =>
      Effect.suspend(() => {
        closing = true;
        return Scope.close(deliveriesScope, Exit.void);
      }),
  };
};
