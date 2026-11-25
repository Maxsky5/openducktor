import { afterAll, beforeAll, jest } from "bun:test";
import { act, configure, getConfig } from "@testing-library/react";

/** Gives Testing Library one fake clock for the tests in this scope. */
export function setupTestingLibraryFakeTimers(): void {
  let originalJest: PropertyDescriptor | undefined;
  let originalTimeout: number;

  beforeAll(async () => {
    // Happy DOM can already have zero-delay callbacks waiting on the real clock.
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    originalJest = Object.getOwnPropertyDescriptor(globalThis, "jest");
    originalTimeout = getConfig().asyncUtilTimeout;
    // Testing Library checks global Jest before advancing the clock in findBy and waitFor.
    Object.defineProperty(globalThis, "jest", { configurable: true, value: jest });
    configure({ asyncUtilTimeout: 800 });
    jest.useFakeTimers();
  });

  afterAll(async () => {
    try {
      // Let Happy DOM drain its zero-delay timer queue before Bun removes the fake timers.
      await act(async () => jest.advanceTimersByTime(0));
    } finally {
      jest.useRealTimers();
      configure({ asyncUtilTimeout: originalTimeout });
      if (originalJest) {
        Object.defineProperty(globalThis, "jest", originalJest);
      } else {
        Reflect.deleteProperty(globalThis, "jest");
      }
    }
  });
}
