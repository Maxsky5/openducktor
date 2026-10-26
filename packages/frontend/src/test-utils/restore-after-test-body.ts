import { onTestFinished } from "bun:test";

// A timed-out body can wait 1000 ms in a Testing Library query, and longer on a loaded CPU, before it
// gets to its finally block.
const TEST_BODY_END_TIMEOUT_MS = 3_000;

/** Resolves true when the test body ends, or false after the time limit. */
const waitForTestBodyEnd = async (bodyEnd: Promise<void>): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeLimit = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), TEST_BODY_END_TIMEOUT_MS);
  });
  try {
    return await Promise.race([bodyEnd.then(() => true as const), timeLimit]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Bun starts the next test while the body of a timed-out test continues to run. A late restore from that
 * body removes the spies and globals of the next test, and its act() calls overlap the act() calls of the
 * next test. Call this function in the test body when it installs its fakes or renders its tree. The
 * returned function runs `restore`: call it at the end of the finally block of the body. The next test
 * starts after this call. If the body does not call it in 3000 ms, the hook runs `restore` and fails.
 */
export const restoreAfterTestBody = (restore: () => void): (() => void) => {
  let isRestored = false;
  const restoreOnce = (): void => {
    if (isRestored) return;
    isRestored = true;
    restore();
  };
  const bodyEnd = Promise.withResolvers<void>();
  onTestFinished(
    async () => {
      const didBodyEnd = await waitForTestBodyEnd(bodyEnd.promise);
      restoreOnce();
      if (!didBodyEnd) {
        throw new Error(
          `The test body did not end in the ${TEST_BODY_END_TIMEOUT_MS} ms after the test ended. Find the step that does not end. The finally block of the test must end the body, for example with dispose() of its harness.`,
        );
      }
    },
    // The hook stops at its own time limit, before the Bun hook timeout.
    TEST_BODY_END_TIMEOUT_MS + 1_000,
  );
  return () => {
    try {
      restoreOnce();
    } finally {
      bodyEnd.resolve();
    }
  };
};
