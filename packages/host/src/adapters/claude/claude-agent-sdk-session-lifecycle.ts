import { Cause, Effect, Exit } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";

/** Run every cleanup step and retain failures in their original order. */
export const settleClaudeSessionSteps = <E>(steps: ReadonlyArray<Effect.Effect<void, E>>) =>
  Effect.gen(function* () {
    let failure: Cause.Cause<E> | undefined;
    for (const step of steps) {
      const exit = yield* Effect.exit(step);
      if (Exit.isFailure(exit)) {
        failure = failure ? Cause.combine(failure, exit.cause) : exit.cause;
      }
    }
    if (failure) return yield* Effect.failCause(failure);
  });

export const claudeSessionLifecycleFailure = (cause: Cause.Cause<unknown>, operation: string) => {
  const errors: unknown[] = [];
  const collect = (cause: unknown): void => {
    if (cause instanceof HostOperationError && cause.cause !== undefined) {
      collect(cause.cause);
    } else if (cause instanceof AggregateError) {
      cause.errors.forEach(collect);
    } else if (!errors.includes(cause)) {
      errors.push(cause);
    }
  };
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) collect(reason.error);
    else if (Cause.isDieReason(reason)) collect(reason.defect);
    else collect(new Error("Claude session lifecycle was interrupted."));
  }
  return new HostOperationError({
    operation,
    message: errors.map(errorMessage).join("\n"),
    cause: errors.length === 1 ? errors[0] : new AggregateError(errors, "Claude session failed."),
  });
};
