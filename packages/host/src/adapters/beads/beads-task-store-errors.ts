import { Effect } from "effect";
import {
  errorMessage,
  HostDependencyError,
  HostInvariantError,
  HostOperationError,
  HostPathAccessError,
  HostPathNotFoundError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";

const toTaskStoreError = (cause: unknown): TaskStoreError => {
  if (
    cause instanceof HostDependencyError ||
    cause instanceof HostInvariantError ||
    cause instanceof HostOperationError ||
    cause instanceof HostPathAccessError ||
    cause instanceof HostPathNotFoundError ||
    cause instanceof HostResourceError ||
    cause instanceof HostValidationError
  ) {
    return cause;
  }
  return new HostOperationError({
    operation: "beadsTaskRepository",
    message: errorMessage(cause),
    cause,
  });
};

export const mapTaskStoreErrors = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, TaskStoreError> => effect.pipe(Effect.mapError(toTaskStoreError));
