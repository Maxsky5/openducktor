import { spyOn } from "bun:test";

type NativeTimer = ReturnType<typeof setTimeout>;

/** The timers of one delay that are still scheduled, and the restore of the native functions. */
export type HeldTimers = {
  /** Runs the callback of a held timer early, keyed by its timer. */
  readonly held: Map<NativeTimer, () => void>;
  restore(): void;
};

/**
 * Lets a test run the timeouts of one delay early. Every timeout still runs natively, and a
 * cleared timeout leaves `held`.
 */
export const holdTimeouts = (delay: number): HeldTimers => {
  const held = new Map<NativeTimer, () => void>();
  const nativeSet = globalThis.setTimeout;
  const nativeClear = globalThis.clearTimeout;
  const sets = spyOn(globalThis, "setTimeout").mockImplementation(
    // SAFETY: the replacement takes the arguments of the native setTimeout and returns its timer.
    ((callback: (...args: unknown[]) => void, timerDelay?: number, ...args: unknown[]) => {
      const timer = nativeSet(callback, timerDelay, ...args);
      if (timerDelay === delay) held.set(timer, () => callback(...args));
      return timer;
    }) as typeof setTimeout,
  );
  const clears = spyOn(globalThis, "clearTimeout").mockImplementation(
    // SAFETY: the replacement takes the timer of the native clearTimeout.
    ((timer?: NativeTimer) => {
      if (timer !== undefined) held.delete(timer);
      nativeClear(timer);
    }) as typeof clearTimeout,
  );
  return {
    held,
    restore: () => {
      sets.mockRestore();
      clears.mockRestore();
    },
  };
};

/**
 * Lets a test run the intervals of one delay early. Every interval still runs natively, and a
 * cleared interval leaves `held`.
 */
export const holdIntervals = (delay: number): HeldTimers => {
  const held = new Map<NativeTimer, () => void>();
  const nativeSet = globalThis.setInterval;
  const nativeClear = globalThis.clearInterval;
  const sets = spyOn(globalThis, "setInterval").mockImplementation(
    // SAFETY: the replacement takes the arguments of the native setInterval and returns its timer.
    ((callback: (...args: unknown[]) => void, timerDelay?: number, ...args: unknown[]) => {
      const timer = nativeSet(callback, timerDelay, ...args);
      if (timerDelay === delay) held.set(timer, () => callback(...args));
      return timer;
    }) as typeof setInterval,
  );
  const clears = spyOn(globalThis, "clearInterval").mockImplementation(
    // SAFETY: the replacement takes the timer of the native clearInterval.
    ((timer?: NativeTimer) => {
      if (timer !== undefined) held.delete(timer);
      nativeClear(timer);
    }) as typeof clearInterval,
  );
  return {
    held,
    restore: () => {
      sets.mockRestore();
      clears.mockRestore();
    },
  };
};
