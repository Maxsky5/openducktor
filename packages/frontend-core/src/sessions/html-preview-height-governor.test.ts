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

  test("freezes upward growth on a repeating small-step loop while still allowing shrinkage", () => {
    let clock = 1000;
    const governor = createHtmlPreviewHeightGovernor({
      now: () => clock,
      repeatGrowthLimit: 10,
      repeatStepMaxPx: 64,
    });

    let height = 200;
    expect(governor.accept(height)).toBe(200);
    for (let step = 1; step < 10; step += 1) {
      clock += 50;
      height += 20;
      expect(governor.accept(height)).toBe(height);
      expect(governor.isGrowthFrozen()).toBe(false);
    }

    clock += 50;
    height += 20;
    expect(governor.accept(height)).toBeNull();
    expect(governor.isGrowthFrozen()).toBe(true);

    // Further upward growth stays blocked, while shrinking still works.
    clock += 50;
    expect(governor.accept(height + 100)).toBeNull();
    expect(governor.accept(240)).toBe(240);

    // Resetting clears the circuit breaker for the next document.
    governor.reset();
    expect(governor.isGrowthFrozen()).toBe(false);
    expect(governor.accept(500)).toBe(500);
  });

  test("rate-limits resize bursts within the sliding window", () => {
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
    expect(governor.accept(200)).toBeNull();

    clock += 1001;
    expect(governor.accept(250)).toBe(250);
  });
});
