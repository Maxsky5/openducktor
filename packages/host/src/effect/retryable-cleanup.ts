import { Deferred, Effect, Exit } from "effect";

/**
 * Owns one cleanup step of a resource. Concurrent callers share the attempt in progress.
 * A success is final, and later calls return its value. A failure keeps the step unfinished,
 * so a later explicit call retries it.
 */
export const createRetryableCleanup = <A, E>(cleanup: Effect.Effect<A, E>): Effect.Effect<A, E> => {
  let completed: { readonly value: A } | null = null;
  let inFlight: Deferred.Deferred<A, E> | null = null;
  return Effect.suspend(() => {
    if (completed) return Effect.succeed(completed.value);
    if (inFlight) return Deferred.await(inFlight);
    const attempt = Deferred.makeUnsafe<A, E>();
    inFlight = attempt;
    return Effect.uninterruptible(
      cleanup.pipe(
        Effect.exit,
        Effect.tap((exit) =>
          Effect.sync(() => {
            inFlight = null;
            if (Exit.isSuccess(exit)) completed = { value: exit.value };
          }),
        ),
        Effect.tap((exit) => Deferred.done(attempt, exit)),
        Effect.flatten,
      ),
    );
  });
};
