import { Cause, Effect, Exit } from "effect";
import { HostOperationError } from "../../effect/host-errors";

export const useRuntimeProbeResource = <Resource>({
  acquire,
  probe,
  release,
  cleanupOperation,
}: {
  acquire: Effect.Effect<Resource, HostOperationError>;
  probe: (resource: Resource) => Effect.Effect<void, HostOperationError>;
  release: (resource: Resource) => Effect.Effect<void, HostOperationError>;
  cleanupOperation: string;
}): Effect.Effect<void, HostOperationError> =>
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
              message: `${Cause.pretty(probeExit.cause)}\nCleanup failed: ${Cause.pretty(
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
            message: Cause.pretty(releaseExit.cause),
          }),
        );
      }
    }),
  );
