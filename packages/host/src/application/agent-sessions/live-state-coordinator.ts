import { Effect } from "effect";

export type LiveStateCoordinator = {
  readonly run: <Success, Failure, Requirements>(
    operation: Effect.Effect<Success, Failure, Requirements>,
  ) => Effect.Effect<Success, Failure, Requirements>;
};

/**
 * Serializes live-projection mutations and attachment handshakes through one
 * host-owned queue. Runtime adapters retain the state; this coordinator only
 * defines the order in which state changes become observable.
 */
export const createLiveStateCoordinator = (): LiveStateCoordinator => {
  const semaphore = Effect.unsafeMakeSemaphore(1);

  return {
    run: (operation) => semaphore.withPermits(1)(operation),
  };
};
