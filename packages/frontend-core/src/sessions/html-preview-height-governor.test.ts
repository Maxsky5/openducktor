import { describe, expect, test } from "bun:test";
import { createHtmlPreviewHeightGovernor } from "./html-preview-height-governor";

describe("createHtmlPreviewHeightGovernor", () => {
  test("clamps heights to configured bounds and skips duplicate values", () => {
    const governor = createHtmlPreviewHeightGovernor({ minHeight: 80, maxHeight: 2000 });

    expect(governor.accept(0)).toBeNull();
    expect(governor.accept(Number.NaN)).toBeNull();
    expect(governor.accept(25)).toBe(80);
    expect(governor.accept(80)).toBeNull();
    expect(governor.accept(320.2)).toBe(321);
    expect(governor.accept(5000)).toBe(2000);
  });

  test("allows finite linear expand animations (e.g. 100px to 300px at 60fps) to finish without freezing", () => {
    let clock = 1000;
    const governor = createHtmlPreviewHeightGovernor({ now: () => clock });

    let height = 100;
    expect(governor.accept(height)).toBe(100);
    for (let step = 1; step <= 20; step += 1) {
      clock += 16;
      height += 10;
      expect(governor.accept(height)).toBe(height);
      expect(governor.isGrowthFrozen()).toBe(false);
    }
    expect(height).toBe(300);
  });

  test("freezes upward growth on a sustained repeating small-step loop, allows shrinking, and recovers after a quiet pause", () => {
    let clock = 1000;
    const governor = createHtmlPreviewHeightGovernor({
      now: () => clock,
      repeatGrowthLimit: 10,
      repeatGrowthDurationMs: 1_000,
      repeatStepMaxPx: 64,
      freezeRecoveryQuietMs: 1_000,
    });

    let height = 200;
    expect(governor.accept(height)).toBe(200);
    // 20 steps at 50ms = 1,000ms of continuous +20px repeating growth trips the breaker.
    for (let step = 1; step <= 20; step += 1) {
      clock += 50;
      height += 20;
      expect(governor.accept(height)).toBe(height);
      expect(governor.isGrowthFrozen()).toBe(false);
    }

    clock += 50;
    height += 20;
    expect(governor.accept(height)).toBeNull();
    expect(governor.isGrowthFrozen()).toBe(true);

    // Ongoing runaway reports stay blocked, while shrinking still works.
    clock += 50;
    expect(governor.accept(height + 100)).toBeNull();
    expect(governor.accept(240)).toBe(240);

    // Once growth attempts stay quiet past the cooldown, settled updates work again.
    clock += 1_500;
    expect(governor.accept(500)).toBe(500);
    expect(governor.isGrowthFrozen()).toBe(false);

    // Resetting clears the circuit breaker immediately for a new document.
    governor.reset();
    expect(governor.isGrowthFrozen()).toBe(false);
    expect(governor.accept(420)).toBe(420);
  });

  test("rate-limits resize bursts within the sliding window without permanently freezing", () => {
    let clock = 1000;
    const governor = createHtmlPreviewHeightGovernor({
      now: () => clock,
      maxChangesPerWindow: 4,
      windowMs: 1000,
    });

    expect(governor.accept(200)).toBe(200);
    expect(governor.accept(400)).toBe(400);
    expect(governor.accept(200)).toBe(200);
    expect(governor.accept(400)).toBe(400);
    expect(governor.accept(500)).toBeNull();
    expect(governor.isGrowthFrozen()).toBe(false);

    clock += 1001;
    expect(governor.accept(500)).toBe(500);
  });

  test("coalesces rate-limited 120Hz expand updates and applies the final settled height after the window expires", () => {
    let clock = 1_000;
    const deferred: number[] = [];
    let scheduled: { run: () => void; at: number; canceled: boolean } | null = null;
    const governor = createHtmlPreviewHeightGovernor({
      now: () => clock,
      onDeferredHeight: (height) => deferred.push(height),
      schedule: (callback, delayMs) => {
        const entry = { run: callback, at: clock + delayMs, canceled: false };
        scheduled = entry;
        return () => {
          entry.canceled = true;
        };
      },
    });

    // 81 reports from 100px to 900px in 10px steps every 8ms exceeds the 60/sec window.
    let lastImmediate = 0;
    for (let step = 0; step <= 80; step += 1) {
      const applied = governor.accept(100 + step * 10);
      if (applied !== null) lastImmediate = applied;
      clock += 8;
    }

    expect(lastImmediate).toBe(690);
    expect(governor.isGrowthFrozen()).toBe(false);
    expect(deferred).toEqual([]);
    expect(scheduled).not.toBeNull();

    // Advance to when the oldest slot expires and run the coalesced flush.
    const flush = scheduled!;
    expect(flush.canceled).toBe(false);
    clock = flush.at;
    flush.run();

    expect(deferred).toEqual([900]);
    expect(governor.isGrowthFrozen()).toBe(false);
  });

  test("cancels a pending deferred flush on reset or dispose", () => {
    let clock = 1_000;
    const deferred: number[] = [];
    let canceledCount = 0;
    const governor = createHtmlPreviewHeightGovernor({
      now: () => clock,
      maxChangesPerWindow: 2,
      windowMs: 1_000,
      onDeferredHeight: (height) => deferred.push(height),
      schedule: () => () => {
        canceledCount += 1;
      },
    });

    expect(governor.accept(100)).toBe(100);
    expect(governor.accept(200)).toBe(200);
    expect(governor.accept(300)).toBeNull();
    governor.reset();
    expect(canceledCount).toBe(1);

    clock += 1_001;
    expect(governor.accept(100)).toBe(100);
    expect(governor.accept(200)).toBe(200);
    expect(governor.accept(300)).toBeNull();
    governor.dispose();
    expect(canceledCount).toBe(2);
    expect(deferred).toEqual([]);
  });

  test("cancels a stale deferred height when content returns to the already applied height", () => {
    let clock = 1_000;
    const deferred: number[] = [];
    let canceled = false;
    const flushes: Array<() => void> = [];
    const governor = createHtmlPreviewHeightGovernor({
      now: () => clock,
      maxChangesPerWindow: 2,
      windowMs: 1_000,
      onDeferredHeight: (height) => deferred.push(height),
      schedule: (callback) => {
        flushes.push(callback);
        return () => {
          canceled = true;
        };
      },
    });

    expect(governor.accept(100)).toBe(100);
    expect(governor.accept(200)).toBe(200);
    // Burst queues stale 100, then content settles back at 200.
    expect(governor.accept(100)).toBeNull();
    expect(governor.accept(200)).toBeNull();
    expect(canceled).toBe(true);

    clock += 1_001;
    // Even if a callback already ran, pendingRawHeight was cleared so nothing is emitted.
    flushes[0]?.();
    expect(deferred).toEqual([]);
  });
});
