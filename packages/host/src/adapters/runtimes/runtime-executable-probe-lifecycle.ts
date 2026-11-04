import { Effect, Exit } from "effect";
import {
  causeMessage,
  HostOperationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";

export const useRuntimeProbeResource = <Resource, ProbeError>({
  acquire,
  probe,
  release,
  cleanupOperation,
}: {
  acquire: Effect.Effect<Resource, HostOperationErrorAggregate>;
  probe: (resource: Resource) => Effect.Effect<void, ProbeError>;
  release: (resource: Resource) => Effect.Effect<void, HostOperationErrorAggregate>;
  cleanupOperation: string;
}): Effect.Effect<void, HostOperationErrorAggregate | ProbeError> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const resource = yield* acquire;
      const probeExit = yield* Effect.exit(restore(probe(resource)));
      const releaseExit = yield* Effect.exit(release(resource));
      if (Exit.isFailure(probeExit)) {
        if (Exit.isFailure(releaseExit)) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: cleanupOperation,
              message: `${causeMessage(probeExit.cause)}\nCleanup failed: ${causeMessage(
                releaseExit.cause,
              )}`,
            }),
          );
        }
        return yield* Effect.failCause(probeExit.cause);
      }
      if (Exit.isFailure(releaseExit)) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: cleanupOperation,
            message: causeMessage(releaseExit.cause),
          }),
        );
      }
    }),
  );
