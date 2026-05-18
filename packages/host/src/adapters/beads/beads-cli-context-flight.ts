import { Deferred, Effect, FiberId } from "effect";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { BeadsCliContext } from "./beads-cli-context";

// A flight publishes one context resolution result to all fibers waiting for it.
export type BeadsCliContextFlight = {
  deferred: Deferred.Deferred<BeadsCliContext, TaskStoreError>;
};

export const makeBeadsCliContextFlight = (): BeadsCliContextFlight => ({
  deferred: Deferred.unsafeMake(FiberId.none),
});

export const awaitBeadsCliContextFlight = (
  flight: BeadsCliContextFlight,
): Effect.Effect<BeadsCliContext, TaskStoreError> => Deferred.await(flight.deferred);

export const resolveBeadsCliContextFlight = ({
  evictCachedContext,
  flight,
  releaseReservation,
  rememberOwnedContext,
  resolveContext,
}: {
  evictCachedContext?: Effect.Effect<void>;
  flight: BeadsCliContextFlight;
  releaseReservation: Effect.Effect<void>;
  rememberOwnedContext: (context: BeadsCliContext) => BeadsCliContext;
  resolveContext: Effect.Effect<BeadsCliContext, TaskStoreError>;
}): Effect.Effect<void> =>
  resolveContext.pipe(
    Effect.map(rememberOwnedContext),
    Effect.exit,
    Effect.tap((exit) =>
      exit._tag === "Failure" && evictCachedContext ? evictCachedContext : Effect.void,
    ),
    Effect.flatMap((exit) => Deferred.done(flight.deferred, exit)),
    Effect.ensuring(releaseReservation),
    Effect.asVoid,
  );
