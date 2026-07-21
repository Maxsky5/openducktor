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
    if (existed) {
      target[key] = value;
      return;
    }

    delete target[key];
  };

export const createAnimationFrameTestDriver = (): AnimationFrameTestDriver => {
  const callbacks = new Map<number, FrameRequestCallback>();
  const autoFlushFrameIds = new Set<number>();
  let nextFrameId = 1;
  let nextFrameTime = 16;
  let isInstalled = false;
  let restoreRequestAnimationFrame: (() => void) | null = null;
  let restoreCancelAnimationFrame: (() => void) | null = null;

  const rememberCurrentGlobals = (): void => {
    if (isInstalled) {
      throw new Error("Animation frame test driver is already installed.");
    }
    const target = globalThis as AnimationFrameGlobals;
    isInstalled = true;
    restoreRequestAnimationFrame = restoreGlobal(
      target,
      "requestAnimationFrame",
      Object.hasOwn(target, "requestAnimationFrame"),
      target.requestAnimationFrame,
    );
    restoreCancelAnimationFrame = restoreGlobal(
      target,
      "cancelAnimationFrame",
      Object.hasOwn(target, "cancelAnimationFrame"),
      target.cancelAnimationFrame,
    );
  };

  const clear = (): void => {
    callbacks.clear();
    autoFlushFrameIds.clear();
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
      autoFlushFrameIds.add(frameId);
      queueMicrotask(() => {
        if (!autoFlushFrameIds.delete(frameId)) {
          return;
        }
        callback(frameTime);
      });
      return frameId;
    }) as typeof requestAnimationFrame;
    target.cancelAnimationFrame = ((frameId: number): void => {
      autoFlushFrameIds.delete(frameId);
    }) as typeof cancelAnimationFrame;
  };

  const restore = (): void => {
    clear();
    restoreRequestAnimationFrame?.();
    restoreCancelAnimationFrame?.();
    restoreRequestAnimationFrame = null;
    restoreCancelAnimationFrame = null;
    isInstalled = false;
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
      const frameTime = nextFrameTime;
      for (const callback of queuedCallbacks) {
        callback(frameTime);
      }
      nextFrameTime += 16;
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
    pendingFrameCount: () => callbacks.size + autoFlushFrameIds.size,
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
