import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createAnimationFrameTestDriver,
  withAnimationFrameTestDriver,
} from "./animation-frame-test-driver";

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const actGlobal = globalThis as ReactActGlobal;
const originalActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT;

beforeAll(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  if (originalActEnvironment === undefined) {
    delete actGlobal.IS_REACT_ACT_ENVIRONMENT;
    return;
  }
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
});

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

  test("uses one timestamp for every callback in a frame", async () => {
    const timestamps: number[] = [];

    await withAnimationFrameTestDriver(async (animationFrameDriver) => {
      globalThis.requestAnimationFrame((timestamp) => timestamps.push(timestamp));
      globalThis.requestAnimationFrame((timestamp) => timestamps.push(timestamp));

      await animationFrameDriver.flushFrame();
    });

    expect(timestamps).toEqual([16, 16]);
  });

  test("cancels auto-flushed callbacks before their microtask runs", async () => {
    const calls: string[] = [];
    const driver = createAnimationFrameTestDriver();
    driver.installAutoFlush();

    try {
      const frameId = globalThis.requestAnimationFrame(() => calls.push("flushed"));
      expect(driver.pendingFrameCount()).toBe(1);

      globalThis.cancelAnimationFrame(frameId);
      await driver.flushMicrotasks();

      expect(driver.pendingFrameCount()).toBe(0);
      expect(calls).toEqual([]);
    } finally {
      driver.restore();
    }
  });

  test("rejects a second install before restoring globals", () => {
    const driver = createAnimationFrameTestDriver();
    driver.install();

    try {
      expect(() => driver.installAutoFlush()).toThrow("already installed");
    } finally {
      driver.restore();
    }
  });
});
