import { act } from "react";

type AnimationFrameGlobals = typeof globalThis & {
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
};

export type AnimationFrameTestDriver = {
  clear: () => void;
  flushFrame: () => Promise<void>;
  flushFrames: () => Promise<void>;
  flushMicrotasks: () => Promise<void>;
  flushTimers: (ticks?: number) => Promise<void>;
  install: () => void;
  installAutoFlush: () => void;
  pendingFrameCount: () => number;
  restore: () => void;
};

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const restoreGlobal =
  <Key extends "requestAnimationFrame" | "cancelAnimationFrame">(
    target: AnimationFrameGlobals,
    key: Key,
    existed: boolean,
    value: AnimationFrameGlobals[Key],
  ) =>
  (): void => {
    if (existed && value) {
      target[key] = value;
      return;
    }

    delete target[key];
  };

export const createAnimationFrameTestDriver = (): AnimationFrameTestDriver => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  let nextFrameTime = 16;
  let restoreRequestAnimationFrame: (() => void) | null = null;
  let restoreCancelAnimationFrame: (() => void) | null = null;

  const rememberCurrentGlobals = (): void => {
    const target = globalThis as AnimationFrameGlobals;
    restoreRequestAnimationFrame = restoreGlobal(
      target,
      "requestAnimationFrame",
      "requestAnimationFrame" in target,
      target.requestAnimationFrame,
    );
    restoreCancelAnimationFrame = restoreGlobal(
      target,
      "cancelAnimationFrame",
      "cancelAnimationFrame" in target,
      target.cancelAnimationFrame,
    );
  };

  const clear = (): void => {
    callbacks.clear();
    nextFrameId = 1;
    nextFrameTime = 16;
  };

  const install = (): void => {
    const target = globalThis as AnimationFrameGlobals;
    clear();
    rememberCurrentGlobals();

    target.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      callbacks.set(frameId, callback);
      return frameId;
    }) as typeof requestAnimationFrame;

    target.cancelAnimationFrame = ((frameId: number): void => {
      callbacks.delete(frameId);
    }) as typeof cancelAnimationFrame;
  };

  const installAutoFlush = (): void => {
    const target = globalThis as AnimationFrameGlobals;
    clear();
    rememberCurrentGlobals();

    target.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
      const frameId = nextFrameId;
      const frameTime = nextFrameTime;
      nextFrameId += 1;
      nextFrameTime += 16;
      queueMicrotask(() => {
        callback(frameTime);
      });
      return frameId;
    }) as typeof requestAnimationFrame;
    target.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  };

  const restore = (): void => {
    clear();
    restoreRequestAnimationFrame?.();
    restoreCancelAnimationFrame?.();
    restoreRequestAnimationFrame = null;
    restoreCancelAnimationFrame = null;
  };

  const flushMicrotasks = async (): Promise<void> => {
    await act(async () => {
      await flushPromises();
    });
  };

  const flushFrame = async (): Promise<void> => {
    if (callbacks.size === 0) {
      return;
    }

    const queuedCallbacks = Array.from(callbacks.values());
    callbacks.clear();

    await act(async () => {
      for (const callback of queuedCallbacks) {
        callback(nextFrameTime);
        nextFrameTime += 16;
      }
      await flushPromises();
    });
  };

  const flushFrames = async (): Promise<void> => {
    while (callbacks.size > 0) {
      await flushFrame();
    }
  };

  const flushTimers = async (ticks = 1): Promise<void> => {
    for (let tick = 0; tick < ticks; tick += 1) {
      await act(async () => {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
        await flushPromises();
      });
    }
  };

  return {
    clear,
    flushFrame,
    flushFrames,
    flushMicrotasks,
    flushTimers,
    install,
    installAutoFlush,
    pendingFrameCount: () => callbacks.size,
    restore,
  };
};

export const withAnimationFrameTestDriver = async <Result>(
  run: (driver: AnimationFrameTestDriver) => Result | Promise<Result>,
): Promise<Result> => {
  const driver = createAnimationFrameTestDriver();
  driver.install();
  try {
    return await run(driver);
  } finally {
    driver.restore();
  }
};
