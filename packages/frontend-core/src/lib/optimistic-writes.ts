/**
 * The writes of one value that show at once and save in order, in the background. Only the newest
 * write decides what shows when the writes settle: its saved value, or the last confirmed value
 * when it fails. A failed write with a later write after it shows nothing.
 */
export type OptimisticWrites<Value> = {
  /**
   * Shows the value at once, then saves it after the earlier writes. `save` returns the saved
   * value, which shows when it is not the shown value and no later write waits.
   */
  write(value: Value, save: () => Promise<Value>): Promise<void>;
  /** The newest write, which fails when it failed, or null when no write waits. */
  settled(): Promise<void> | null;
};

export const createOptimisticWrites = <Value>({
  show,
  readConfirmed,
  onIdle,
}: {
  show: (value: Value) => void;
  /** The saved value. It is read when a write starts while no other write waits. */
  readConfirmed: () => Value;
  /** Runs when the last waiting write settles. */
  onIdle?: () => void;
}): OptimisticWrites<Value> => {
  let confirmed: { readonly value: Value } | null = null;
  let latest: Promise<unknown> = Promise.resolve();
  let pending = 0;

  return {
    async write(value, save) {
      if (pending === 0) confirmed = { value: readConfirmed() };
      pending += 1;
      show(value);
      const write = latest.then(save, save);
      latest = write;
      try {
        const saved = await write;
        confirmed = { value: saved };
        if (pending === 1 && saved !== value) show(saved);
      } catch (cause) {
        if (pending === 1 && confirmed) show(confirmed.value);
        throw cause;
      } finally {
        pending -= 1;
        if (pending === 0) onIdle?.();
      }
    },
    settled: () => (pending > 0 ? latest.then(() => undefined) : null),
  };
};
