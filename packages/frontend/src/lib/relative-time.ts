import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** Short elapsed time such as `now`, `6m`, `2h`, `3d`, `4mo`, or `1y`. */
export const formatElapsedShort = (elapsedMs: number): string => {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < MINUTE_MS) return "now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  if (elapsed < MONTH_MS) return `${Math.floor(elapsed / DAY_MS)}d`;
  if (elapsed < YEAR_MS) return `${Math.floor(elapsed / MONTH_MS)}mo`;
  return `${Math.floor(elapsed / YEAR_MS)}y`;
};

/** Elapsed time for a sentence, such as `just now` or `6m ago`. */
export const formatElapsedAgo = (elapsedMs: number): string => {
  const short = formatElapsedShort(elapsedMs);
  return short === "now" ? "just now" : `${short} ago`;
};

const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
let clockNow = Date.now();

const subscribeMinuteClock = (listener: () => void): (() => void) => {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const notify of clockListeners) notify();
    }, MINUTE_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
};

/**
 * Current time that advances once a minute while a component shows relative labels.
 * It drives display only; it never triggers a data read.
 */
export const useMinuteClock = (): number =>
  useSyncExternalStore(
    subscribeMinuteClock,
    () => clockNow,
    () => clockNow,
  );
