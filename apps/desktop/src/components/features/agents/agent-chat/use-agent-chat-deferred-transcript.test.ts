import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useAgentChatDeferredTranscript } from "./use-agent-chat-deferred-transcript";

const animationFrameCallbacks = new Map<number, FrameRequestCallback>();
const timeoutCallbacks = new Map<number, () => void>();
let nextAnimationFrameId = 1;
let nextTimeoutId = 1;
const previousActEnvironment = (
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT;

const setActEnvironment = (value: boolean | undefined): void => {
  const target = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  if (typeof value === "undefined") {
    delete target.IS_REACT_ACT_ENVIRONMENT;
    return;
  }

  target.IS_REACT_ACT_ENVIRONMENT = value;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const flushDeferredWork = async (): Promise<void> => {
  while (animationFrameCallbacks.size > 0 || timeoutCallbacks.size > 0) {
    const queuedAnimationFrames = Array.from(animationFrameCallbacks.values());
    animationFrameCallbacks.clear();

    if (queuedAnimationFrames.length > 0) {
      await act(async () => {
        for (const callback of queuedAnimationFrames) {
          callback(16);
        }
        await flush();
      });
    }

    const queuedTimeouts = Array.from(timeoutCallbacks.values());
    timeoutCallbacks.clear();

    if (queuedTimeouts.length > 0) {
      await act(async () => {
        for (const callback of queuedTimeouts) {
          callback();
        }
        await flush();
      });
    }
  }
};

describe("useAgentChatDeferredTranscript", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  beforeEach(() => {
    setActEnvironment(true);

    animationFrameCallbacks.clear();
    timeoutCallbacks.clear();
    nextAnimationFrameId = 1;
    nextTimeoutId = 1;

    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const frameId = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrameCallbacks.set(frameId, callback);
      return frameId;
    }) as typeof requestAnimationFrame;

    globalThis.cancelAnimationFrame = ((frameId: number) => {
      animationFrameCallbacks.delete(frameId);
    }) as typeof cancelAnimationFrame;

    globalThis.setTimeout = ((callback: TimerHandler) => {
      const timeoutId = nextTimeoutId;
      nextTimeoutId += 1;
      timeoutCallbacks.set(timeoutId, () => {
        if (typeof callback === "function") {
          callback();
        }
      });
      return timeoutId as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;

    globalThis.clearTimeout = ((timeoutId: ReturnType<typeof setTimeout>) => {
      timeoutCallbacks.delete(Number(timeoutId));
    }) as typeof clearTimeout;
  });

  afterEach(() => {
    setActEnvironment(previousActEnvironment);

    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  test("cancels stale deferred session switches during rapid A to B to A changes", async () => {
    const harness = createSharedHookHarness(useAgentChatDeferredTranscript, {
      activeSessionId: "session-a",
    });

    await harness.mount();
    expect(harness.getLatest().isTranscriptRenderDeferred).toBe(false);

    await harness.update({ activeSessionId: "session-b" });
    expect(harness.getLatest().isTranscriptRenderDeferred).toBe(true);

    await harness.update({ activeSessionId: "session-a" });
    expect(harness.getLatest().isTranscriptRenderDeferred).toBe(false);

    await flushDeferredWork();

    expect(harness.getLatest().isTranscriptRenderDeferred).toBe(false);

    await harness.unmount();
  });
});
