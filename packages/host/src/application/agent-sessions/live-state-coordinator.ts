import { createSerialLane, type SerialLane } from "../../effect/serial-gate";

export type LiveStateCoordinator = SerialLane;

/**
 * Serializes live-projection mutations and repository refreshes through one
 * host-owned queue. Runtime adapters retain the state; this coordinator only
 * defines the order in which state changes become observable.
 */
export const createLiveStateCoordinator = (): LiveStateCoordinator => createSerialLane();
