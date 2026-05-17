import { Deferred, Effect, FiberId } from "effect";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { BeadsCliContext } from "./beads-cli-context";

export type BeadsCliContextFlight = {
  deferred: Deferred.Deferred<BeadsCliContext, TaskStoreError>;
};

export const makeBeadsCliContextFlight = (): BeadsCliContextFlight => ({
  deferred: Deferred.unsafeMake(FiberId.none),
});

export const awaitBeadsCliContextFlight = (
  flight: BeadsCliContextFlight,
): Effect.Effect<BeadsCliContext, TaskStoreError> => Deferred.await(flight.deferred);

export const completeBeadsCliContextFlight = ({
  contextEffect,
  flight,
  onComplete,
  onFailure,
  trackContext,
}: {
  contextEffect: Effect.Effect<BeadsCliContext, TaskStoreError>;
  flight: BeadsCliContextFlight;
  onComplete: Effect.Effect<void>;
  onFailure?: Effect.Effect<void>;
  trackContext: (context: BeadsCliContext) => BeadsCliContext;
}): Effect.Effect<void> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(contextEffect.pipe(Effect.map(trackContext)));
    if (exit._tag === "Failure" && onFailure) {
      yield* onFailure;
    }
    yield* Deferred.done(flight.deferred, exit);
  }).pipe(Effect.ensuring(onComplete));
