export type CancelScheduledTask = () => void;

export type ScheduleTask = (callback: () => void, delayMs: number) => CancelScheduledTask;

export const scheduleTask: ScheduleTask = (callback, delayMs) => {
  const timeoutId = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timeoutId);
};
