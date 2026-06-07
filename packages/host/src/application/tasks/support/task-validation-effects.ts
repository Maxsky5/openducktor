import { Effect } from "effect";
import {
  ensurePullRequestManagementStatus,
  TaskPolicyError,
  validateManualCloseTask,
  validateParentRelationshipsForCreate,
  validateParentRelationshipsForUpdate,
  validateTransition,
} from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";

export type TaskPolicyValidationError = HostValidationError | TaskPolicyError;
export type TaskTransitionValidationError = TaskPolicyValidationError;

const taskPolicyValidationError = (cause: unknown): TaskPolicyValidationError => {
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
    catch: taskPolicyValidationError,
  });

export const validateManualCloseTaskEffect = (
  ...args: Parameters<typeof validateManualCloseTask>
): Effect.Effect<void, TaskPolicyValidationError> =>
  Effect.try({
    try: () => validateManualCloseTask(...args),
    catch: taskPolicyValidationError,
  });

export const validatePullRequestManagementStatusEffect = (
  status: Parameters<typeof ensurePullRequestManagementStatus>[0],
): Effect.Effect<void, TaskPolicyValidationError> =>
  Effect.try({
    try: () => ensurePullRequestManagementStatus(status),
    catch: taskPolicyValidationError,
  });

export const validateParentRelationshipsForCreateEffect = (
  ...args: Parameters<typeof validateParentRelationshipsForCreate>
): Effect.Effect<void, TaskPolicyValidationError> =>
  Effect.try({
    try: () => validateParentRelationshipsForCreate(...args),
    catch: taskPolicyValidationError,
  });

export const validateParentRelationshipsForUpdateEffect = (
  ...args: Parameters<typeof validateParentRelationshipsForUpdate>
): Effect.Effect<void, TaskPolicyValidationError> =>
  Effect.try({
    try: () => validateParentRelationshipsForUpdate(...args),
    catch: taskPolicyValidationError,
  });
