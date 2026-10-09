import { Effect } from "effect";
import { type HostError, HostOperationError, isHostError } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";

export const workspaceSessionStoreEffect = <A>(
  effect: Effect.Effect<A, TaskStoreError>,
): Effect.Effect<A, HostError> =>
  effect.pipe(
    Effect.mapError((cause) =>
      isHostError(cause)
        ? cause
        : new HostOperationError({
            operation: "workspaceSession.persist",
            message: cause.message,
            cause,
          }),
    ),
  );
