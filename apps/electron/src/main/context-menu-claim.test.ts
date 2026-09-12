import { describe, expect, test } from "bun:test";
import { createContextMenuClaimTracker } from "./context-menu-claim";

const createClock = () => {
  let current = 0;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
};

describe("context menu claim tracker", () => {
  test("suppresses the event that follows a claim", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);

    tracker.claim();
    clock.advance(10);

    expect(tracker.shouldSuppressEvent(clock.now())).toBe(true);
  });

  test("does not suppress an unrelated event after the claimed event", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);

    tracker.claim();
    clock.advance(10);
    expect(tracker.shouldSuppressEvent(clock.now())).toBe(true);

    clock.advance(30);
    expect(tracker.shouldSuppressEvent(clock.now())).toBe(false);
  });

  test("suppresses an event when the claim arrives right after it", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);

    const eventAt = clock.now();
    expect(tracker.shouldSuppressEvent(eventAt)).toBe(false);

    clock.advance(5);
    tracker.claim();

    expect(tracker.claimArrivedAfter(eventAt)).toBe(true);
    clock.advance(5);
    expect(tracker.shouldSuppressEvent(clock.now())).toBe(false);
  });

  test("matches each claim to one event", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);

    tracker.claim();
    tracker.claim();
    clock.advance(5);

    expect(tracker.shouldSuppressEvent(clock.now())).toBe(true);
    expect(tracker.shouldSuppressEvent(clock.now())).toBe(true);
    expect(tracker.shouldSuppressEvent(clock.now())).toBe(false);
  });

  test("drops a stale claim instead of suppressing a later event", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);

    tracker.claim();
    clock.advance(500);

    expect(tracker.shouldSuppressEvent(clock.now())).toBe(false);
  });
});
