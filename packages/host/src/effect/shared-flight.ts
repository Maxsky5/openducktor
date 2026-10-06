import { Deferred, Effect, FiberId } from "effect";

/**
 * Runs work at most once per key at a time. A caller that asks for a key while its work runs waits
 * for the same result. A call after the work ends starts new work. Callers cannot interrupt the
 * shared work, but time limits inside the work can stop it.
 */
export const createKeyedSharedFlight = <K, A, E>() => {
  const flights = new Map<K, Deferred.Deferred<A, E>>();

  const complete = (key: K, deferred: Deferred.Deferred<A, E>, work: Effect.Effect<A, E>) =>
    Effect.exit(work).pipe(
      Effect.flatMap((exit) => Deferred.done(deferred, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          if (flights.get(key) === deferred) {
            flights.delete(key);
          }
        }),
      ),
    );

  const run = (key: K, work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        // Reserve the key before the first yield so concurrent callers share one run.
        const reservation = yield* Effect.sync(() => {
          const existing = flights.get(key);
          if (existing) {
            return { created: false, deferred: existing };
          }
          const deferred = Deferred.unsafeMake<A, E>(FiberId.none);
          flights.set(key, deferred);
          return { created: true, deferred };
        });
        if (reservation.created) {
          // A fork inherits the uninterruptible region. Time limits in the work need interruption.
          yield* Effect.forkDaemon(Effect.interruptible(complete(key, reservation.deferred, work)));
        }
        return yield* restore(Deferred.await(reservation.deferred));
      }),
    );

  return { run };
};

/** The single-key form of `createKeyedSharedFlight`. */
export const createSharedFlight = <A, E>() => {
  const flight = createKeyedSharedFlight<"work", A, E>();
  return { run: (work: Effect.Effect<A, E>) => flight.run("work", work) };
};
