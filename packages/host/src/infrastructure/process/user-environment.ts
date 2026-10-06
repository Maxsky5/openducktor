import { Effect } from "effect";
import { createSharedFlight } from "../../effect/shared-flight";
import type {
  UserEnvironmentPort,
  UserEnvironmentResolution,
  UserEnvironmentState,
} from "../../ports/user-environment-port";

export const createUserEnvironment = (
  initial: UserEnvironmentResolution,
  resolve: Effect.Effect<UserEnvironmentResolution>,
): UserEnvironmentPort => {
  let current: UserEnvironmentState = { ...initial, revision: 0 };
  const flight = createSharedFlight<void, never>();
  const resolveAndStore = resolve.pipe(
    Effect.map((next) => {
      current = { ...next, revision: current.revision + 1 };
    }),
  );

  return {
    current: () => current,
    refresh: () => flight.run(resolveAndStore),
  };
};
