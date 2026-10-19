import { Cause, Effect, Exit } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";

/** Marks lifecycle-owned wrappers so aggregation keeps native errors intact. */
export class ClaudeSessionLifecycleError extends HostOperationError {
  constructor(
    operation: string,
    readonly causes: ReadonlyArray<unknown>,
  ) {
    super({
      operation,
      message: causes.map(errorMessage).join("\n"),
      cause: causes.length === 1 ? causes[0] : new AggregateError(causes, "Claude session failed."),
    });
  }
}

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
    if (cause instanceof ClaudeSessionLifecycleError) {
      cause.causes.forEach(collect);
    } else if (!errors.includes(cause)) {
      errors.push(cause);
    }
  };
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) collect(reason.error);
    else if (Cause.isDieReason(reason)) collect(reason.defect);
    else collect(new Error("Claude session lifecycle was interrupted."));
  }
  return new ClaudeSessionLifecycleError(operation, errors);
};
