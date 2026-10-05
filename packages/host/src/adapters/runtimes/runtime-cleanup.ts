import { Effect, Exit } from "effect";
import {
  causeMessage,
  HostOperationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import { createRetryableCleanup } from "../../effect/retryable-cleanup";

/**
 * The cleanup of one runtime generation: it releases the live state, then stops the process.
 * Each step is final once it succeeds and stays retryable after a failure. Concurrent callers,
 * such as a stop and a crash cleanup, share one attempt.
 */
export const createRuntimeCleanup = ({
  runtimeId,
  operation,
  releaseLiveState,
  stopProcess,
  onStart,
}: {
  runtimeId: string;
  operation: string;
  /** Must be retryable itself. A release after its success must do nothing. */
  releaseLiveState: Effect.Effect<void, HostOperationErrorAggregate>;
  stopProcess: Effect.Effect<void, HostOperationErrorAggregate>;
  /** Marks the stop as deliberate before any step runs. */
  onStart: () => void;
}): Effect.Effect<void, HostOperationErrorAggregate> => {
  const stopProcessOnce = createRetryableCleanup(stopProcess);
  return createRetryableCleanup(
    Effect.gen(function* () {
      onStart();
      const liveExit = yield* Effect.exit(releaseLiveState);
      const processExit = yield* Effect.exit(stopProcessOnce);
      const errors: string[] = [];
      if (Exit.isFailure(liveExit)) errors.push(`live session: ${causeMessage(liveExit.cause)}`);
      if (Exit.isFailure(processExit)) errors.push(`runtime: ${causeMessage(processExit.cause)}`);
      if (errors.length > 0) {
        return yield* new HostOperationError({
          operation,
          message: errors.join("\n"),
          cause: { liveExit, processExit },
          details: { runtimeId },
        });
      }
    }),
  );
};
