import { Effect } from "effect";
import { TaskPolicyError } from "../../domain/task/task-policy-error";
import { errorMessage, HostOperationError, isHostError } from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import {
  GitProviderCapabilityError,
  GitProviderRepositoryError,
  GitProviderResolutionError,
} from "../../ports/git-provider-errors";
import {
  TaskMutationProgressFailure,
  TaskCreationProgressFailure,
} from "./task-mutation-progress-failure";
import type { TaskServiceError } from "./task-service";

export const mapTaskServiceErrors = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, TaskServiceError> => effect.pipe(Effect.mapError(toTaskServiceError));

export const mapTaskMutationProgressErrors = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure> =>
  effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof TaskMutationProgressFailure ? cause : toTaskServiceError(cause),
    ),
  );

export const mapTaskCreationProgressErrors = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, TaskServiceError | TaskCreationProgressFailure> =>
  effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof TaskCreationProgressFailure ? cause : toTaskServiceError(cause),
    ),
  );

const toTaskServiceError = (cause: unknown): TaskServiceError => {
  if (isTaskServiceError(cause)) {
    return cause;
  }
  return new HostOperationError({
    operation: "task.service",
    message: errorMessage(cause),
    cause,
  });
};

const isTaskServiceError = (cause: unknown): cause is TaskServiceError =>
  cause instanceof GitProviderCapabilityError ||
  cause instanceof GitProviderRepositoryError ||
  cause instanceof GitProviderResolutionError ||
  cause instanceof TaskAssetError ||
  cause instanceof TaskPolicyError ||
  isHostError(cause);
