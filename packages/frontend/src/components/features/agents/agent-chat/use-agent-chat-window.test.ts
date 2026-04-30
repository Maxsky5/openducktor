import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, createRef } from "react";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import {
  buildAgentChatWindowTurns,
  CHAT_TURN_WINDOW_BATCH,
  CHAT_TURN_WINDOW_INIT,
} from "./agent-chat-thread-windowing";
import { resolveAgentChatEffectiveTurnStart } from "./use-agent-chat-history-window";
import { useAgentChatWindow } from "./use-agent-chat-window";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessProps = {
  rows: AgentChatWindowRow[];
  activeExternalSessionId: string | null;
  isSessionViewLoading: boolean;
  isSessionWorking?: boolean;
  syncBottomAfterComposerLayoutRef?: { current: (() => void) | null };
};

type HookResult = ReturnType<typeof useAgentChatWindow>;

type MockResizeObserverController = {
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
  observedElements: Set<Element>;
};

const ROW_HEIGHT_PX = 40;
const mockResizeObserverControllers = new Set<MockResizeObserverController>();
const animationFrameCallbacks = new Map<number, FrameRequestCallback>();
let nextAnimationFrameId = 1;

class MockResizeObserver implements ResizeObserver {
  private readonly observedElements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    mockResizeObserverControllers.add({
      callback,
      observer: this,
      observedElements: this.observedElements,
    });
  }

  disconnect(): void {
    this.observedElements.clear();
  }

  observe(target: Element): void {
    this.observedElements.add(target);
  }

  unobserve(target: Element): void {
    this.observedElements.delete(target);
  }
}

const triggerResizeObservers = (): void => {
  for (const controller of mockResizeObserverControllers) {
    if (controller.observedElements.size === 0) {
      continue;
    }

    controller.callback(
      Array.from(controller.observedElements).map((target) => ({
        borderBoxSize: [] as ResizeObserverSize[],
        contentBoxSize: [] as ResizeObserverSize[],
        contentRect: {} as DOMRectReadOnly,
        devicePixelContentBoxSize: [] as ResizeObserverSize[],
        target,
      })),
      controller.observer,
    );
  }
};

const createTurnRows = (turnCount: number, externalSessionId = "session-1"): AgentChatWindowRow[] =>
  Array.from({ length: turnCount }, (_, turnIndex) => [
    {
      kind: "message" as const,
      key: `${externalSessionId}:user-${turnIndex}`,
      message: {
        id: `user-${turnIndex}`,
        role: "user" as const,
        content: `Question ${turnIndex}`,
        timestamp: "2026-02-20T10:01:00.000Z",
      },
    },
    {
      kind: "message" as const,
      key: `${externalSessionId}:assistant-${turnIndex}`,
      message: {
        id: `assistant-${turnIndex}`,
        role: "assistant" as const,
        content: `Answer ${turnIndex}`,
        timestamp: "2026-02-20T10:01:01.000Z",
        meta: {
          kind: "assistant" as const,
          agentRole: "spec" as const,
          isFinal: true,
          profileId: "Hephaestus (Deep Agent)",
          durationMs: 1_000,
        },
      },
    },
  ]).flat();

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const flushAnimationFrames = async (): Promise<void> => {
  while (animationFrameCallbacks.size > 0) {
    const queuedCallbacks = Array.from(animationFrameCallbacks.values());
    animationFrameCallbacks.clear();

    await act(async () => {
      for (const callback of queuedCallbacks) {
        callback(16);
      }
      await flush();
    });
  }
};

const getMaxScrollTop = (container: HTMLDivElement): number => {
  return Math.max(0, container.scrollHeight - container.clientHeight);
};

const createHarness = () => {
  const messagesContainerRef = createRef<HTMLDivElement>();
  const messagesContentRef = createRef<HTMLDivElement>();
  const latestResultRef: { current: HookResult | null } = { current: null };

  const Harness = (props: HarnessProps): null => {
    const result = useAgentChatWindow({
      ...props,
      isSessionWorking: props.isSessionWorking ?? false,
      messagesContainerRef,
      messagesContentRef,
      ...(props.syncBottomAfterComposerLayoutRef
        ? {
            syncBottomAfterComposerLayoutRef: props.syncBottomAfterComposerLayoutRef,
          }
        : {}),
    });
    latestResultRef.current = result;
    return null;
  };

  return { Harness, latestResultRef, messagesContainerRef, messagesContentRef };
};

const getLatestResult = (latestResultRef: { current: HookResult | null }): HookResult => {
  const result = latestResultRef.current;
  if (!result) {
    throw new Error("Expected hook result");
  }

  return result;
};

const mountHarness = async (
  props: HarnessProps,
  options?: {
    attachDom?: boolean;
    extraContentHeightPx?: { current: number };
    containerClientHeight?: number;
    rowHeightPx?: number;
  },
): Promise<{
  getLatestResult: () => HookResult;
  messagesContainerRef: ReturnType<typeof createHarness>["messagesContainerRef"];
  messagesContentRef: ReturnType<typeof createHarness>["messagesContentRef"];
  update: (nextProps: HarnessProps) => Promise<void>;
  unmount: () => Promise<void>;
}> => {
  const { latestResultRef, messagesContainerRef, messagesContentRef } = createHarness();
  const extraContentHeightPx = options?.extraContentHeightPx ?? { current: 0 };
  const rowHeightPx = options?.rowHeightPx ?? ROW_HEIGHT_PX;

  if (options?.attachDom) {
    const container = document.createElement("div");
    const content = document.createElement("div");
    let scrollTopValue = 0;
    const scrollTo = mock((options: ScrollToOptions) => {
      if (typeof options.top !== "number") {
        throw new Error("scrollTo called without explicit top value");
      }

      container.scrollTop = Number(options.top);
    });

    Object.defineProperty(container, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      get: () => options?.containerClientHeight ?? 300,
    });
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      get: () =>
        getLatestResult(latestResultRef).windowedRows.length * rowHeightPx +
        extraContentHeightPx.current,
    });
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        scrollTopValue = Math.max(0, Math.min(value, maxScrollTop));
      },
    });

    messagesContainerRef.current = container;
    messagesContentRef.current = content;
  }

  const harness = createSharedHookHarness((nextProps: HarnessProps) => {
    const result = useAgentChatWindow({
      ...nextProps,
      isSessionWorking: nextProps.isSessionWorking ?? false,
      messagesContainerRef,
      messagesContentRef,
      ...(nextProps.syncBottomAfterComposerLayoutRef
        ? {
            syncBottomAfterComposerLayoutRef: nextProps.syncBottomAfterComposerLayoutRef,
          }
        : {}),
    });
    latestResultRef.current = result;
    return result;
  }, props);

  await harness.mount();

  return {
    getLatestResult: () => getLatestResult(latestResultRef),
    messagesContainerRef,
    messagesContentRef,
    update: (nextProps: HarnessProps) => harness.update(nextProps),
    unmount: () => harness.unmount(),
  };
};

const dispatchWheelUp = async (container: HTMLDivElement): Promise<void> => {
  container.dispatchEvent(new WheelEvent("wheel", { deltaY: -24 }));
  await flush();
};

const dispatchScroll = async (container: HTMLDivElement): Promise<void> => {
  container.dispatchEvent(new Event("scroll"));
  await flush();
};

const dispatchPointerDown = async (container: HTMLDivElement): Promise<void> => {
  container.dispatchEvent(new PointerEvent("pointerdown"));
  await flush();
};

describe("useAgentChatWindow", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    mockResizeObserverControllers.clear();
    animationFrameCallbacks.clear();
    nextAnimationFrameId = 1;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const frameId = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrameCallbacks.set(frameId, callback);
      return frameId;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((frameId: number) => {
      animationFrameCallbacks.delete(frameId);
    }) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test("starts with the latest turn window", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness({
      rows,
      activeExternalSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const turns = buildAgentChatWindowTurns(rows);
    const expectedWindowStart = turns[2]?.start ?? 0;

    expect(harness.getLatestResult().windowStart).toBe(expectedWindowStart);

    await harness.unmount();
  });

  test("keeps the same windowedRows reference when the window inputs are unchanged", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness({
      rows,
      activeExternalSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const initialWindowedRows = harness.getLatestResult().windowedRows;

    await harness.update({
      rows,
      activeExternalSessionId: "session-1",
      isSessionViewLoading: false,
    });

    expect(harness.getLatestResult().windowedRows).toBe(initialWindowedRows);

    await harness.unmount();
  });

  test("fills hidden history until the transcript overflows", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      {
        attachDom: true,
        containerClientHeight: 900,
      },
    );

    await act(async () => {
      await flush();
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);

    await harness.unmount();
  });

  test("scrolling near the top backfills older turns and preserves scroll position", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 160;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(container.scrollTop).toBe(320);

    await harness.unmount();
  });

  test("fast upward scrolling keeps backfilling until the viewport leaves the top threshold", async () => {
    const rows = createTurnRows(20);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      {
        attachDom: true,
        containerClientHeight: 100,
        rowHeightPx: 10,
      },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 0;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(container.scrollTop).toBeGreaterThanOrEqual(200);

    await harness.unmount();
  });

  test("scrollToTop reveals the full transcript and moves to top", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(container.scrollTop).toBe(0);
    expect(harness.getLatestResult().isNearTop).toBe(true);
    expect(harness.getLatestResult().isNearBottom).toBe(false);
    expect(container.style.overflowAnchor).toBe("none");

    await harness.unmount();
  });

  test("recomputes top and bottom edge visibility after scrolling away from the top", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });

    expect(harness.getLatestResult().isNearTop).toBe(true);
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    container.scrollTop = 160;
    await act(async () => {
      await dispatchPointerDown(container);
      await dispatchScroll(container);
    });

    expect(harness.getLatestResult().isNearTop).toBe(false);
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("keeps the latest turn window on the first populated render after a deferred empty frame", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness({
      rows: [],
      activeExternalSessionId: "session-1",
      isSessionViewLoading: true,
    });

    expect(harness.getLatestResult().windowStart).toBe(0);

    await harness.update({
      rows,
      activeExternalSessionId: "session-1",
      isSessionViewLoading: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(
      buildAgentChatWindowTurns(rows)[2]?.start ?? 0,
    );

    await harness.unmount();
  });

  test("resolves the latest turn window immediately when the active session changes", () => {
    expect(
      resolveAgentChatEffectiveTurnStart({
        activeExternalSessionId: "session-2",
        previousSessionId: "session-1",
        turnStart: 0,
        latestTurnStart: 12,
        rowsLength: 40,
        pendingLatestReset: false,
      }),
    ).toBe(12);
  });

  test("switching sessions after revealing all history resets the next session to its latest turns", async () => {
    const firstSessionRows = createTurnRows(12, "session-1");
    const secondSessionRows = createTurnRows(12, "session-2");
    const harness = await mountHarness(
      {
        rows: firstSessionRows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);

    await harness.update({
      rows: secondSessionRows,
      activeExternalSessionId: "session-2",
      isSessionViewLoading: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(
      buildAgentChatWindowTurns(secondSessionRows)[2]?.start ?? 0,
    );

    await harness.unmount();
  });

  test("switching sessions clears manual scroll state so late-rendered content stays pinned", async () => {
    const firstSessionRows = createTurnRows(12, "session-1");
    const secondSessionRows = createTurnRows(12, "session-2");
    const extraContentHeightPx = { current: 0 };
    const harness = await mountHarness(
      {
        rows: firstSessionRows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true, extraContentHeightPx },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 120;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.update({
      rows: secondSessionRows,
      activeExternalSessionId: "session-2",
      isSessionViewLoading: false,
    });

    extraContentHeightPx.current = 200;
    await act(async () => {
      triggerResizeObservers();
      await flush();
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(true);
    expect(container.style.overflowAnchor).toBe("none");
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("deferred session hydration after a switch stays pinned through late content growth", async () => {
    const firstSessionRows = createTurnRows(12, "session-1");
    const secondSessionRows = createTurnRows(12, "session-2");
    const extraContentHeightPx = { current: 0 };
    const harness = await mountHarness(
      {
        rows: firstSessionRows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true, extraContentHeightPx },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 120;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.update({
      rows: [],
      activeExternalSessionId: "session-2",
      isSessionViewLoading: true,
    });

    await harness.update({
      rows: secondSessionRows,
      activeExternalSessionId: "session-2",
      isSessionViewLoading: false,
    });

    extraContentHeightPx.current = 200;
    await act(async () => {
      triggerResizeObservers();
      await flush();
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(true);
    expect(container.style.overflowAnchor).toBe("none");
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("scrollToBottom collapses back to the latest turns and jumps to bottom", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });
    await flushAnimationFrames();

    await act(async () => {
      harness.getLatestResult().scrollToBottom();
      await flush();
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().windowStart).toBe(
      buildAgentChatWindowTurns(rows)[2]?.start ?? 0,
    );
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("ignores non-user scroll restoration while following the transcript", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    // Small layout-shift drift near bottom should be auto-corrected
    container.scrollTop = getMaxScrollTop(container) - 50;
    await act(async () => {
      await dispatchScroll(container);
    });

    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("does not auto-follow appended content after the user scrolls up", async () => {
    const rows = createTurnRows(8);
    const extraContentHeightPx = { current: 0 };
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
      },
      { attachDom: true, extraContentHeightPx },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 120;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    extraContentHeightPx.current = 200;
    await act(async () => {
      triggerResizeObservers();
      await flush();
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(false);
    expect(container.scrollTop).toBe(120);

    await harness.unmount();
  });

  test("preserves the visible anchor when staged history prepends while scrolled", async () => {
    const rows = createTurnRows(8);
    const extraContentHeightPx = { current: 0 };
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: false,
      },
      { attachDom: true, extraContentHeightPx },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 120;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    harness.getLatestResult().preserveScrollBeforeStagedPrepend();
    extraContentHeightPx.current = 200;
    await harness.update({
      rows,
      activeExternalSessionId: "session-1",
      isSessionViewLoading: false,
      isSessionWorking: false,
    });

    expect(container.scrollTop).toBe(320);
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("does not delta-preserve staged prepends while following the transcript", async () => {
    const rows = createTurnRows(8);
    const extraContentHeightPx = { current: 0 };
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: false,
      },
      { attachDom: true, extraContentHeightPx },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = getMaxScrollTop(container);
    await act(async () => {
      await dispatchScroll(container);
    });

    harness.getLatestResult().preserveScrollBeforeStagedPrepend();
    extraContentHeightPx.current = 200;
    await harness.update({
      rows,
      activeExternalSessionId: "session-1",
      isSessionViewLoading: false,
      isSessionWorking: false,
    });

    expect(container.scrollTop).toBe(getMaxScrollTop(container) - 200);

    await harness.unmount();
  });

  test("keeps the bottom locked while streaming when the user stays pinned", async () => {
    const rows = createTurnRows(4);
    const extraContentHeightPx = { current: 0 };
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
      },
      { attachDom: true, extraContentHeightPx },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = container.scrollHeight;
    extraContentHeightPx.current = 200;

    await act(async () => {
      triggerResizeObservers();
      await flush();
    });
    await flushAnimationFrames();

    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("keeps the current transcript window when a new turn is appended while pinned", async () => {
    const initialRows = createTurnRows(12);
    const nextRows = createTurnRows(13);
    const harness = await mountHarness(
      {
        rows: initialRows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
      },
      { attachDom: true },
    );
    const initialWindowStart = harness.getLatestResult().windowStart;

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = container.scrollHeight;
    await act(async () => {
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    await act(async () => {
      harness.getLatestResult().scrollToBottomOnSend();
      await flush();
    });

    await harness.update({
      rows: nextRows,
      activeExternalSessionId: "session-1",
      isSessionViewLoading: false,
      isSessionWorking: true,
    });
    await act(async () => {
      triggerResizeObservers();
      await flush();
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().windowStart).toBe(initialWindowStart);
    expect(harness.getLatestResult().isNearBottom).toBe(true);
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("scrollToBottomOnSend clears user scroll state and jumps to bottom", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 40;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });

    await act(async () => {
      harness.getLatestResult().scrollToBottomOnSend();
      await flush();
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(true);
    expect(harness.getLatestResult().windowStart).toBe(
      buildAgentChatWindowTurns(rows)[2]?.start ?? 0,
    );
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("scrollToBottomOnSend keeps full history expanded when already at the bottom", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });
    await flushAnimationFrames();

    container.scrollTop = getMaxScrollTop(container);
    await act(async () => {
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);

    await act(async () => {
      harness.getLatestResult().scrollToBottomOnSend();
      await flush();
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("syncBottomAfterComposerLayoutRef keeps the transcript pinned while following", async () => {
    const rows = createTurnRows(8);
    const extraContentHeightPx = { current: 0 };
    const syncBottomAfterComposerLayoutRef = { current: null as (() => void) | null };
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
        syncBottomAfterComposerLayoutRef,
      },
      { attachDom: true, extraContentHeightPx },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }
    if (!syncBottomAfterComposerLayoutRef.current) {
      throw new Error("Expected sync callback");
    }

    container.scrollTop = getMaxScrollTop(container);
    await act(async () => {
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    extraContentHeightPx.current = 200;
    await act(async () => {
      syncBottomAfterComposerLayoutRef.current?.();
      await flush();
    });
    await flushAnimationFrames();

    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("syncBottomAfterComposerLayoutRef does not override manual scroll position", async () => {
    const rows = createTurnRows(8);
    const extraContentHeightPx = { current: 0 };
    const syncBottomAfterComposerLayoutRef = { current: null as (() => void) | null };
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
        syncBottomAfterComposerLayoutRef,
      },
      { attachDom: true, extraContentHeightPx },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }
    if (!syncBottomAfterComposerLayoutRef.current) {
      throw new Error("Expected sync callback");
    }

    container.scrollTop = 120;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    extraContentHeightPx.current = 200;
    await act(async () => {
      syncBottomAfterComposerLayoutRef.current?.();
      await flush();
    });
    await flushAnimationFrames();

    expect(container.scrollTop).toBe(120);
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("exports the expected turn window constants", () => {
    expect(CHAT_TURN_WINDOW_INIT).toBe(10);
    expect(CHAT_TURN_WINDOW_BATCH).toBe(8);
  });

  test("resets scroll intent when the user returns to bottom so small layout shifts do not break following", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    // User scrolls up to show intent
    container.scrollTop = 120;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(false);

    // User scrolls back to bottom
    container.scrollTop = getMaxScrollTop(container);
    await act(async () => {
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(true);

    // Simulate a small layout-shift drift (e.g. message height change on agent completion)
    container.scrollTop = getMaxScrollTop(container) - 50;
    await act(async () => {
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    // Should auto-scroll back to bottom because scroll intent was reset and drift is small
    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("preserves scroll position after a large scroll jump when following (scrollbar track click)", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeExternalSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    // User scrolls up to show intent
    container.scrollTop = 120;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(false);

    // User scrolls back to bottom
    container.scrollTop = getMaxScrollTop(container);
    await act(async () => {
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(true);

    // Simulate a large scroll jump (e.g. scrollbar track click) — should be treated as user-initiated
    const largeJumpScrollTop = Math.floor(getMaxScrollTop(container) / 2);
    container.scrollTop = largeJumpScrollTop;
    await act(async () => {
      await dispatchScroll(container);
    });
    await flushAnimationFrames();

    // Should NOT auto-scroll back to bottom because the jump is too large
    expect(container.scrollTop).toBe(largeJumpScrollTop);
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });
});
