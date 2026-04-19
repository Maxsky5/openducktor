import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useAgentChatLoadingOverlay } from "./use-agent-chat-loading-overlay";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useAgentChatLoadingOverlay", () => {
  test("keeps the overlay visible until session loading settles", async () => {
    const harness = createSharedHookHarness(useAgentChatLoadingOverlay, {
      sessionId: "session-1",
      isSessionViewLoading: true,
    });

    await harness.mount();
    expect(harness.getLatest()).toBe(true);

    await harness.update({ sessionId: "session-1", isSessionViewLoading: false });
    expect(harness.getLatest()).toBe(false);

    await harness.unmount();
  });

  test("does not re-show the overlay for same-session steady state updates", async () => {
    const harness = createSharedHookHarness(useAgentChatLoadingOverlay, {
      sessionId: "session-1",
      isSessionViewLoading: false,
    });

    await harness.mount();
    expect(harness.getLatest()).toBe(false);

    await harness.update({ sessionId: "session-1", isSessionViewLoading: false });
    expect(harness.getLatest()).toBe(false);

    await harness.unmount();
  });

  test("starts a new loading cycle when the selected session changes", async () => {
    const harness = createSharedHookHarness(useAgentChatLoadingOverlay, {
      sessionId: "session-1",
      isSessionViewLoading: false,
    });

    await harness.mount();
    expect(harness.getLatest()).toBe(false);

    await harness.update({ sessionId: "session-2", isSessionViewLoading: true });
    expect(harness.getLatest()).toBe(true);

    await harness.update({ sessionId: "session-2", isSessionViewLoading: false });
    expect(harness.getLatest()).toBe(false);

    await harness.unmount();
  });

  test("does not show the overlay when switching to an already ready session", async () => {
    const harness = createSharedHookHarness(useAgentChatLoadingOverlay, {
      sessionId: "session-1",
      isSessionViewLoading: false,
    });

    await harness.mount();
    expect(harness.getLatest()).toBe(false);

    await harness.update({ sessionId: "session-2", isSessionViewLoading: false });
    expect(harness.getLatest()).toBe(false);

    await harness.unmount();
  });

  test("does not flash the overlay for short same-session hydration", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let nextTimeoutId = 1;
    const timeoutCallbacks = new Map<number, () => void>();

    globalThis.setTimeout = ((callback: TimerHandler) => {
      const timeoutId = nextTimeoutId;
      nextTimeoutId += 1;
      timeoutCallbacks.set(timeoutId, () => {
        if (typeof callback === "function") {
          callback();
        }
      });
      return timeoutId as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((timeoutId: ReturnType<typeof setTimeout>) => {
      timeoutCallbacks.delete(Number(timeoutId));
    }) as unknown as typeof globalThis.clearTimeout;

    const harness = createSharedHookHarness(useAgentChatLoadingOverlay, {
      sessionId: "session-1",
      isSessionViewLoading: false,
    });

    try {
      await harness.mount();
      expect(harness.getLatest()).toBe(false);

      await harness.update({ sessionId: "session-1", isSessionViewLoading: true });
      expect(harness.getLatest()).toBe(false);

      await harness.update({ sessionId: "session-1", isSessionViewLoading: false });
      expect(harness.getLatest()).toBe(false);
      expect(timeoutCallbacks.size).toBe(0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      await harness.unmount();
    }
  });

  test("shows the overlay after the same-session hydration threshold elapses", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let nextTimeoutId = 1;
    const timeoutCallbacks = new Map<number, () => void>();

    globalThis.setTimeout = ((callback: TimerHandler) => {
      const timeoutId = nextTimeoutId;
      nextTimeoutId += 1;
      timeoutCallbacks.set(timeoutId, () => {
        if (typeof callback === "function") {
          callback();
        }
      });
      return timeoutId as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((timeoutId: ReturnType<typeof setTimeout>) => {
      timeoutCallbacks.delete(Number(timeoutId));
    }) as unknown as typeof globalThis.clearTimeout;

    const harness = createSharedHookHarness(useAgentChatLoadingOverlay, {
      sessionId: "session-1",
      isSessionViewLoading: false,
    });

    try {
      await harness.mount();
      expect(harness.getLatest()).toBe(false);

      await harness.update({ sessionId: "session-1", isSessionViewLoading: true });
      expect(harness.getLatest()).toBe(false);

      const [timeoutId] = [...timeoutCallbacks.keys()];
      await act(async () => {
        timeoutCallbacks.get(timeoutId ?? -1)?.();
      });
      await harness.waitFor((value) => value === true);

      await harness.update({ sessionId: "session-1", isSessionViewLoading: false });
      expect(harness.getLatest()).toBe(false);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      await harness.unmount();
    }
  });
});
