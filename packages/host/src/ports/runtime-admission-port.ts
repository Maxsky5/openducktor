import type { Effect } from "effect";
import type { HostResourceError } from "../effect/host-errors";

export type RuntimeUnavailableDetails = {
  readonly runtimeKind: string;
  readonly state: string;
  readonly nextAction: string;
};

/** Admits runtime-dependent controls only while the shared runtime of that kind is ready. */
export type RuntimeAdmissionPort = {
  readonly admit: <A, E, R>(
    runtimeKind: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | HostResourceError<RuntimeUnavailableDetails>, R>;
};
