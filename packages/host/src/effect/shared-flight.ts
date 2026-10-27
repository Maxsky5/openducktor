import { Deferred, Effect, type Scope } from "effect";

/**
 * Runs work at most once per key at a time. A caller that asks for a key while its work runs waits
 * for the same result. A call after the work ends starts new work. Callers cannot interrupt the
 * shared work, but time limits inside the work can stop it. With `scope`, the work runs in that
 * scope, so closing the scope stops it.
 */
export const createKeyedSharedFlight = <K, A, E>(options: { scope?: Scope.Scope } = {}) => {
  const flights = new Map<K, Deferred.Deferred<A, E>>();

  const complete = (key: K, deferred: Deferred.Deferred<A, E>, work: Effect.Effect<A, E>) =>
    Effect.onExit(work, (exit) =>
      Effect.sync(() => {
        // Release the key before waking callers, so a caller that resumes can start a new run.
        if (flights.get(key) === deferred) {
          flights.delete(key);
        }
        Deferred.doneUnsafe(deferred, exit);
      }),
    ).pipe(Effect.ignore);

  const run = (key: K, work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        // Reserve the key before the first yield so concurrent callers share one run.
        const reservation = yield* Effect.sync(() => {
          const existing = flights.get(key);
          if (existing) {
            return { created: false, deferred: existing };
          }
          const deferred = Deferred.makeUnsafe<A, E>();
          flights.set(key, deferred);
          return { created: true, deferred };
        });
        if (reservation.created) {
          // A fork inherits the uninterruptible region. Time limits in the work need interruption.
          const shared = Effect.interruptible(complete(key, reservation.deferred, work));
          yield* options.scope ? Effect.forkIn(shared, options.scope) : Effect.forkDetach(shared);
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
