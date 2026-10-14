import { Effect, Exit, Fiber, Scope } from "effect";
import { HostValidationError } from "./host-errors";

/** The host scope owns execution; a caller owns only its wait. */
export const createHostOperationWorkers = () => {
  const scope = Scope.makeUnsafe();
  let closing = false;
  return {
    run: <A, E, R>(work: Effect.Effect<A, E, R>) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (closing)
            return yield* new HostValidationError({
              field: "operation",
              message: "The host is shutting down. Reopen the application before starting work.",
            });
          const worker = yield* Effect.forkIn(work, scope, { uninterruptible: false });
          return yield* restore(Fiber.join(worker));
        }),
      ),
    shutdown: () =>
      Effect.suspend(() => {
        closing = true;
        return Scope.close(scope, Exit.void);
      }),
  };
};
