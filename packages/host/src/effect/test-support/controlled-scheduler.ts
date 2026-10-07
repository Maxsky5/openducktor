import { Scheduler } from "effect";

/**
 * Holds scheduled fiber work until the test calls `step`. After `release`, work runs on real
 * timers again. Pass `scheduler` to `Effect.runFork`.
 */
export const createControlledScheduler = () => {
  let pending: Array<() => void> = [];
  let released = false;
  const runLater = (task: () => void) => {
    const timer = setTimeout(task, 0);
    return () => clearTimeout(timer);
  };
  const scheduler = new Scheduler.MixedScheduler("async", (task) => {
    if (released) return runLater(task);
    pending.push(task);
    return () => {
      pending = pending.filter((candidate) => candidate !== task);
    };
  });
  const takePending = () => {
    const tasks = pending;
    pending = [];
    return tasks;
  };
  return {
    scheduler,
    /** Runs the work that is scheduled now. Work that it schedules waits for the next step. */
    step() {
      for (const task of takePending()) task();
    },
    release() {
      released = true;
      for (const task of takePending()) runLater(task);
    },
  };
};
