import { describe, expect, test } from "bun:test";
import { CONTEXT_MENU_CLAIM_WINDOW_MS, createContextMenuClaimTracker } from "./context-menu-claim";

const target = { webContentsId: 1, x: 10, y: 20 };

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

    tracker.claim(target);
    clock.advance(10);

    expect(tracker.takeClaim(tracker.trackEvent(target))).toBe(true);
  });

  test("does not suppress an unrelated event after the claimed event", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);

    tracker.claim(target);
    clock.advance(10);
    expect(tracker.takeClaim(tracker.trackEvent(target))).toBe(true);

    clock.advance(30);
    expect(tracker.takeClaim(tracker.trackEvent(target))).toBe(false);
  });

  test("suppresses an event when the claim arrives right after it", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);

    const eventId = tracker.trackEvent(target);

    clock.advance(5);
    tracker.claim(target);

    expect(tracker.takeClaim(eventId)).toBe(true);
    expect(tracker.takeClaim(tracker.trackEvent(target))).toBe(false);
  });

  test("suppresses an event when its claim arrives near the end of the claim window", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);

    const eventId = tracker.trackEvent(target);
    clock.advance(CONTEXT_MENU_CLAIM_WINDOW_MS - 50);
    tracker.claim(target);

    expect(tracker.takeClaim(eventId)).toBe(true);
  });

  test("matches each claim to one event", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);

    tracker.claim(target);
    tracker.claim(target);
    clock.advance(5);

    expect(tracker.takeClaim(tracker.trackEvent(target))).toBe(true);
    expect(tracker.takeClaim(tracker.trackEvent(target))).toBe(true);
    expect(tracker.takeClaim(tracker.trackEvent(target))).toBe(false);
  });

  test("drops a stale claim instead of suppressing a later event", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);

    tracker.claim(target);
    clock.advance(500);

    expect(tracker.takeClaim(tracker.trackEvent(target))).toBe(false);
  });

  test("keeps a later claim with its context menu event", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);
    const firstEvent = tracker.trackEvent(target);

    clock.advance(100);
    const claimedTarget = { ...target, x: 30 };
    const secondEvent = tracker.trackEvent(claimedTarget);
    clock.advance(5);
    tracker.claim(claimedTarget);

    expect(tracker.takeClaim(firstEvent)).toBe(false);
    expect(tracker.takeClaim(secondEvent)).toBe(true);
  });

  test("does not match claims from another window", () => {
    const clock = createClock();
    const tracker = createContextMenuClaimTracker(clock.now);
    const firstEvent = tracker.trackEvent(target);
    const otherWindowTarget = { ...target, webContentsId: 2 };
    const secondEvent = tracker.trackEvent(otherWindowTarget);

    tracker.claim(otherWindowTarget);

    expect(tracker.takeClaim(firstEvent)).toBe(false);
    expect(tracker.takeClaim(secondEvent)).toBe(true);
  });
});
