import { Effect } from "effect";
import { ensurePullRequestManagementStatus, validateTransition } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";

export const validateTaskTransitionEffect = (
  ...args: Parameters<typeof validateTransition>
): Effect.Effect<void, HostValidationError> =>
  Effect.try({
    try: () => validateTransition(...args),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
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
