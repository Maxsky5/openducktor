/**
 * The timers of one demo session. The end of the demo cancels every timer, so no scripted event
 * shows after Reset demo or Exit demo.
 */
export type DemoClock = {
  /** The current time. */
  now(): number;
  nowIso(): string;
  /** An ISO time `ms` before now, for sample data. */
  agoIso(ms: number): string;
  /** Runs `run` after `ms`, unless the demo ends first. Returns a cancel function. */
  after(ms: number, run: () => void): () => void;
  /** Runs `run` on a later task, unless the demo ends first. */
  soon(run: () => void): void;
  /** Runs `run` once when the demo ends. */
  onEnd(run: () => void): void;
  readonly ended: boolean;
};

/** A timer of the clock: a system timer, or the number of a test timer. */
export type DemoTimerHandle = ReturnType<typeof setTimeout> | number;

/** The timer functions of the clock. Tests pass their own to run scripts without waiting. */
export type DemoTimers = {
  now(): number;
  setTimeout(run: () => void, ms: number): DemoTimerHandle;
  clearTimeout(timer: DemoTimerHandle): void;
};

const SYSTEM_TIMERS: DemoTimers = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

export const createDemoClock = (
  lifetime: AbortSignal,
  system: DemoTimers = SYSTEM_TIMERS,
): DemoClock => {
  const { now } = system;
  const timers = new Set<DemoTimerHandle>();
  lifetime.addEventListener(
    "abort",
    () => {
      for (const timer of timers) system.clearTimeout(timer);
      timers.clear();
    },
    { once: true },
  );
  const after = (ms: number, run: () => void) => {
    if (lifetime.aborted) return () => {};
    const timer = system.setTimeout(() => {
      timers.delete(timer);
      if (!lifetime.aborted) run();
    }, ms);
    timers.add(timer);
    return () => {
      system.clearTimeout(timer);
      timers.delete(timer);
    };
  };
  // Events go out in the order of their publication. One timer drains the queue, because the
  // Android timer queue does not keep the order of timers that are due at the same time.
  const queue: (() => void)[] = [];
  let draining = false;
  const drain = () => {
    draining = false;
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (lifetime.aborted) return;
      next();
    }
  };
  lifetime.addEventListener("abort", () => queue.splice(0), { once: true });
  return {
    now,
    nowIso: () => new Date(now()).toISOString(),
    agoIso: (ms) => new Date(now() - ms).toISOString(),
    after,
    soon: (run) => {
      if (lifetime.aborted) return;
      queue.push(run);
      if (draining) return;
      draining = true;
      after(0, drain);
    },
    onEnd: (run) => {
      if (lifetime.aborted) run();
      else lifetime.addEventListener("abort", run, { once: true });
    },
    get ended() {
      return lifetime.aborted;
    },
  };
};
