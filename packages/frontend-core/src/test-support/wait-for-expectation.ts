const RETRY_INTERVAL_MS = 10;

/**
 * Runs an assertion until it passes or the timeout ends, then throws its last error.
 * Use it in tests that run without DOM globals. The Testing Library `waitFor` needs a document.
 */
export const waitForExpectation = async (
  assertion: () => void | Promise<void>,
  timeoutMs = 900,
): Promise<void> => {
  const startedAt = Date.now();
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
};
