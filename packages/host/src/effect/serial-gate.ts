import { Deferred, Effect } from "effect";

/**
 * Runs operations one at a time, in arrival order. Use it instead of an Effect `Semaphore` as a
 * lock: a semaphore lets a later caller take a released permit before an earlier waiter resumes.
 */
export type SerialLane = {
  run<A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
};

/** Runs operations one at a time for each key, in arrival order. Keys do not wait for each other. */
export type SerialGate = {
  run<A, E, R>(key: string, operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
  /** Reports whether an operation holds or waits for the key. Never waits. */
  isActive(key: string): boolean;
  /** Waits until every operation that holds or waits for a key now has left. */
  drain(): Effect.Effect<void>;
};

type Lane = {
  /** Completes when the last operation in the lane leaves. */
  last: Deferred.Deferred<void> | null;
  users: number;
};

/**
 * Selects a lane and joins it in one synchronous step, so no caller can see the lane between
 * the selection and the join. `onIdle` runs in the same step that makes the lane empty.
 */
const runInLane = <A, E, R>(
  selectLane: () => Lane,
  operation: Effect.Effect<A, E, R>,
  onIdle: (lane: Lane) => void,
): Effect.Effect<A, E, R> =>
  Effect.uninterruptibleMask((restore) => {
    const lane = selectLane();
    const previous = lane.last;
    const done = Deferred.makeUnsafe<void>();
    lane.last = done;
    lane.users += 1;
    const waitForPrevious = previous ? Deferred.await(previous) : Effect.void;
    // Resume on the scheduler after a wait: a direct handoff to each waiter would nest one
    // stack frame per queued operation.
    const waitForTurn = previous ? Effect.andThen(waitForPrevious, Effect.yieldNow) : Effect.void;
    let started = false;
    const leave = Effect.suspend(() => {
      lane.users -= 1;
      if (lane.users === 0) {
        lane.last = null;
        onIdle(lane);
      }
      // A caller that leaves before its turn makes the next caller wait for the one before it.
      return Deferred.completeWith(done, started ? Effect.void : waitForPrevious);
    });
    const run = waitForTurn.pipe(
      Effect.andThen(
        Effect.suspend(() => {
          started = true;
          return operation;
        }),
      ),
    );
    return restore(run).pipe(Effect.ensuring(leave));
  });

export const createSerialLane = (): SerialLane => {
  const lane: Lane = { last: null, users: 0 };
  return {
    run: (operation) =>
      runInLane(
        () => lane,
        operation,
        () => {},
      ),
  };
};

/** Keeps one serial lane for each key and forgets a lane when it has no operation. */
export const createSerialGate = (): SerialGate => {
  const lanes = new Map<string, Lane>();
  const run: SerialGate["run"] = (key, operation) =>
    runInLane(
      () => {
        let lane = lanes.get(key);
        if (!lane) {
          lane = { last: null, users: 0 };
          lanes.set(key, lane);
        }
        return lane;
      },
      operation,
      (lane) => {
        if (lanes.get(key) === lane) lanes.delete(key);
      },
    );

  return {
    run,
    isActive: (key) => (lanes.get(key)?.users ?? 0) > 0,
    drain: () =>
      Effect.suspend(() =>
        Effect.all(
          [...lanes.keys()].map((key) => run(key, Effect.void)),
          { concurrency: "unbounded", discard: true },
        ),
      ),
  };
};
