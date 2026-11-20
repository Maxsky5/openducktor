import type { DemoTimerHandle, DemoTimers } from "../demo/demo-clock";

/**
 * Timers that run only when a test advances them, so a scripted run of 15 seconds ends at once.
 * Test support only: the app uses the system timers.
 */
export const createManualTimers = (start = Date.UTC(2026, 10, 18, 12, 0, 0)) => {
  let time = start;
  let nextId = 1;
  const pending = new Map<DemoTimerHandle, { id: number; at: number; run: () => void }>();
  const timers: DemoTimers = {
    now: () => time,
    setTimeout: (run, ms) => {
      const id = nextId++;
      pending.set(id, { id, at: time + ms, run });
      return id;
    },
    clearTimeout: (id) => {
      pending.delete(id);
    },
  };
  const settle = async () => {
    // Each round lets one step of promise work run, in order.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    for (let round = 0; round < 20; round += 1) await Promise.resolve();
  };
  /** Moves the time forward and runs every timer that is due, in time order. */
  const advance = async (ms: number) => {
    const end = time + ms;
    await settle();
    for (;;) {
      const timer = [...pending.values()]
        .filter((entry) => entry.at <= end)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!timer) break;
      pending.delete(timer.id);
      time = Math.max(time, timer.at);
      timer.run();
      // A due timer can start promise work that schedules the next timer, so each one settles first.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      await settle();
    }
    time = end;
  };
  return { timers, advance, pendingCount: () => pending.size };
};
