/**
 * Runs `run` for each item, at most `limit` at a time, and keeps the result or the failure of each
 * item in item order. One failure does not stop the other items.
 */
export const settleWithLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> => {
  const results: PromiseSettledResult<R>[] = [];
  // The lanes share one iterator, so each item runs once.
  const queue = items.entries();
  const lane = async (): Promise<void> => {
    for (const [index, item] of queue) {
      // Each lane runs one item at a time, so the limit holds.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      results[index] = await run(item).then(
        (value): PromiseSettledResult<R> => ({ status: "fulfilled", value }),
        (reason): PromiseSettledResult<R> => ({ status: "rejected", reason }),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
};
