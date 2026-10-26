/**
 * Starts a read that the caller awaits after other work, such as a slow fetch. The read failure
 * is handled at once, so it is not an unhandled rejection meanwhile. The returned function gives
 * the read outcome back, including its failure.
 */
export const startEarlyRead = (read: Promise<void>): (() => Promise<void>) => {
  const settled = Promise.allSettled([read]);
  return async () => {
    const [outcome] = await settled;
    if (outcome.status === "rejected") throw outcome.reason;
  };
};
