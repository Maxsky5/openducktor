import { Effect } from "effect";
import { type HostError, toHostOperationError } from "../../effect/host-errors";

type QueuedChange<Change> = {
  readonly change: Change;
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
};

/**
 * Applies the live changes of one runtime one at a time, in the order of `enqueue`. Changes wait
 * until `startForwarding`, so none applies before the host attached the runtime. A release
 * rejects the changes that still wait.
 */
export const createOrderedLiveChangeQueue = <Change>({
  runtimeLabel,
  runtimeId,
  operationPrefix,
  apply,
  onApplyFailure,
}: {
  readonly runtimeLabel: string;
  readonly runtimeId: string;
  readonly operationPrefix: string;
  readonly apply: (change: Change) => Effect.Effect<void, unknown>;
  /** Runs before the publisher of a failed change gets the cause. */
  readonly onApplyFailure?: (change: Change, cause: unknown) => Effect.Effect<void>;
}) => {
  const queue: QueuedChange<Change>[] = [];
  let forwarding = false;
  let released = false;
  let draining: Promise<void> = Promise.resolve();

  const drain = (): Promise<void> => {
    draining = draining.then(async () => {
      while (forwarding && queue.length > 0) {
        const next = queue.shift();
        if (!next) continue;
        try {
          await Effect.runPromise(apply(next.change));
          next.resolve();
        } catch (cause) {
          if (onApplyFailure) await Effect.runPromise(onApplyFailure(next.change, cause));
          next.reject(cause);
        }
      }
    });
    return draining;
  };

  return {
    get released(): boolean {
      return released;
    },
    /** Queues a change. The promise settles when the host applied it. */
    enqueue: (change: Change): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        if (released) {
          reject(new Error(`${runtimeLabel} runtime '${runtimeId}' is already released.`));
          return;
        }
        queue.push({ change, resolve, reject });
        if (forwarding) void drain();
      }),
    /** Applies the queued changes, then each later change at once. */
    startForwarding: (): Effect.Effect<void, HostError> =>
      Effect.tryPromise({
        try: async () => {
          if (released) {
            throw new Error(`${runtimeLabel} runtime '${runtimeId}' is already released.`);
          }
          forwarding = true;
          await drain();
        },
        catch: (cause) =>
          toHostOperationError(cause, `${operationPrefix}.start-forwarding`, { runtimeId }),
      }),
    /** Rejects the waiting changes. Returns false when the queue was already released. */
    release: (): boolean => {
      if (released) return false;
      released = true;
      forwarding = false;
      for (const queued of queue.splice(0)) {
        queued.reject(new Error(`${runtimeLabel} runtime '${runtimeId}' was released.`));
      }
      return true;
    },
  };
};
