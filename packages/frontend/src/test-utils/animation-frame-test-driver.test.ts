import { describe, expect, test } from "bun:test";
import { withAnimationFrameTestDriver } from "./animation-frame-test-driver";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("animation-frame-test-driver", () => {
  test("flushes queued frames and skips cancelled frames", async () => {
    const calls: string[] = [];

    await withAnimationFrameTestDriver(async (animationFrameDriver) => {
      const cancelledFrameId = globalThis.requestAnimationFrame(() => {
        calls.push("cancelled");
      });
      globalThis.requestAnimationFrame(() => {
        calls.push("flushed");
      });
      globalThis.cancelAnimationFrame(cancelledFrameId);

      expect(animationFrameDriver.pendingFrameCount()).toBe(1);
      await animationFrameDriver.flushFrame();
    });

    expect(calls).toEqual(["flushed"]);
  });

  test("restores frame globals after failures", async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    await expect(
      withAnimationFrameTestDriver(async () => {
        throw new Error("test failure");
      }),
    ).rejects.toThrow("test failure");

    expect(globalThis.requestAnimationFrame).toBe(originalRequestAnimationFrame);
    expect(globalThis.cancelAnimationFrame).toBe(originalCancelAnimationFrame);
  });
});
