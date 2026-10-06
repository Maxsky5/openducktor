import { Effect, Fiber } from "effect";

/**
 * Owns background jobs that outlive their caller. A job reports its own failures. Shutdown stops
 * new jobs, then interrupts the running jobs and waits until they finish.
 */
export const createBackgroundJobs = () => {
  const running = new Set<Fiber.Fiber<void>>();
  let stopped = false;

  return {
    /** Starts the job with the caller's services and references. Does nothing after shutdown. */
    start: (job: Effect.Effect<void>): Effect.Effect<void> =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        // Check shutdown, start the job, and register it in one synchronous step.
        yield* Effect.sync(() => {
          if (stopped) return;
          const fiber = Effect.runForkWith(context)(job);
          running.add(fiber);
          fiber.addObserver(() => running.delete(fiber));
        });
      }),
    shutdown: (): Effect.Effect<void> =>
      Effect.suspend(() => {
        stopped = true;
        return Fiber.interruptAll([...running]);
      }),
  };
};
