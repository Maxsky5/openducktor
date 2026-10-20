import { Cause, Effect, Exit } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";

/** Run each step even if an earlier step fails. Keep failures in step order. */
export const runAllSteps = <E>(
  steps: ReadonlyArray<Effect.Effect<void, E>>,
): Effect.Effect<void, E> =>
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

export const toSessionError = (
  cause: Cause.Cause<unknown>,
  operation: string,
): ClaudeSessionError => {
  const errors: unknown[] = [];
  const collect = (cause: unknown): void => {
    if (cause instanceof ClaudeSessionError) {
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
  return new ClaudeSessionError(operation, errors);
};

/** Unwrap only this error type so native errors keep their identity and details. */
export class ClaudeSessionError extends HostOperationError {
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
