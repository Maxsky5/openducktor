import { Effect } from "effect";
import { createSerialLane } from "../../effect/serial-gate";

export type LiveStateCoordinator = {
  readonly run: <Success, Failure, Requirements>(
    operation: Effect.Effect<Success, Failure, Requirements>,
  ) => Effect.Effect<Success, Failure, Requirements>;
};

/**
 * Serializes live-projection mutations and repository refreshes through one
 * host-owned queue. Runtime adapters retain the state; this coordinator only
 * defines the order in which state changes become observable.
 */
export const createLiveStateCoordinator = (): LiveStateCoordinator => {
  const lane = createSerialLane();

  return {
    run: (operation) => lane.run(operation),
  };
};
