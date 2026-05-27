import { Effect } from "effect";
import {
  ensurePullRequestManagementStatus,
  TaskPolicyError,
  validateTransition,
} from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";

export type TaskTransitionValidationError = HostValidationError | TaskPolicyError;

const transitionValidationError = (cause: unknown): TaskTransitionValidationError => {
  if (cause instanceof TaskPolicyError) {
    return cause;
  }

  return new HostValidationError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
};

export const validateTaskTransitionEffect = (
  ...args: Parameters<typeof validateTransition>
): Effect.Effect<void, TaskTransitionValidationError> =>
  Effect.try({
    try: () => validateTransition(...args),
    catch: transitionValidationError,
  });

export const validatePullRequestManagementStatusEffect = (
  status: Parameters<typeof ensurePullRequestManagementStatus>[0],
): Effect.Effect<void, HostValidationError> =>
  Effect.try({
    try: () => ensurePullRequestManagementStatus(status),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
