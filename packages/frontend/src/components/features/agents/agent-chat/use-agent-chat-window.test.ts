import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, createRef } from "react";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { AGENT_CHAT_ROW_WINDOW_SIZE, AGENT_CHAT_ROW_WINDOW_STEP } from "./agent-chat-row-windows";
import type { AgentChatTranscriptRow } from "./agent-chat-transcript-model";
import { buildAgentChatTurnAnchors } from "./agent-chat-transcript-model";
import { createAnimationFrameTestDriver } from "./test-support/animation-frame-test-driver";
import { useAgentChatWindow } from "./use-agent-chat-window";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

type HarnessProps = {
  rows: AgentChatTranscriptRow[];
  turnAnchors?: ReturnType<typeof buildAgentChatTurnAnchors>;
  displayedSessionKey: string | null;
  shouldResetForTranscriptLoad: boolean;
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
const animationFrameDriver = createAnimationFrameTestDriver();

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

const createTurnRows = (
  turnCount: number,
  externalSessionId = "session-1",
): AgentChatTranscriptRow[] =>
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

const createSingleTurnRows = (
  rowCount: number,
  externalSessionId = "single-turn-session",
): AgentChatTranscriptRow[] => {
  if (rowCount < 1) {
    throw new Error("Expected at least one row");
  }

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    if (rowIndex === 0) {
      return {
        kind: "message" as const,
        key: `${externalSessionId}:user-0`,
        message: {
          id: "user-0",
          role: "user" as const,
          content: "Question",
          timestamp: "2026-02-20T10:01:00.000Z",
        },
      };
    }

    return {
      kind: "message" as const,
      key: `${externalSessionId}:assistant-${rowIndex}`,
      message: {
        id: `assistant-${rowIndex}`,
        role: "assistant" as const,
        content: `Answer chunk ${rowIndex}`,
        timestamp: "2026-02-20T10:01:01.000Z",
        meta: {
          kind: "assistant" as const,
          agentRole: "spec" as const,
          isFinal: true,
          profileId: "Hephaestus (Deep Agent)",
        },
      },
    };
  });
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
      turnAnchors: props.turnAnchors ?? buildAgentChatTurnAnchors(props.rows),
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
        getLatestResult(latestResultRef).visibleRows.length * rowHeightPx +
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
      turnAnchors: nextProps.turnAnchors ?? buildAgentChatTurnAnchors(nextProps.rows),
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

  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    mockResizeObserverControllers.clear();
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    animationFrameDriver.install();
  });

  afterEach(() => {
    if (previousActEnvironment === undefined) {
      delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    } else {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }

    globalThis.ResizeObserver = originalResizeObserver;
    animationFrameDriver.restore();
  });

  test("short transcripts start in the only row window", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness({
      rows,
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().visibleRows).toHaveLength(rows.length);

    await harness.unmount();
  });

  test("keeps the same visibleRows reference when the window inputs are unchanged", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness({
      rows,
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
    });

    const initialWindowedRows = harness.getLatestResult().visibleRows;

    await harness.update({
      rows,
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().visibleRows).toBe(initialWindowedRows);

    await harness.unmount();
  });

  test("caps oversized single-turn transcripts by row budget", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + 25);
    const harness = await mountHarness({
      rows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(25);
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(harness.getLatestResult().visibleTurnAnchors).toEqual([
      {
        key: "single-turn-session:user-0",
        startRow: 0,
        endRowExclusive: AGENT_CHAT_ROW_WINDOW_SIZE,
      },
    ]);

    await harness.unmount();
  });

  test("scrollToTop reveals only a bounded row batch for oversized single-turn transcripts", async () => {
    const hiddenRowsAfterReveal = 25;
    const rows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP + hiddenRowsAfterReveal,
    );
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(harness.getLatestResult().visibleRows[0]).toBe(rows[0]);
    expect(container.scrollTop).toBe(0);
    expect(harness.getLatestResult().isNearTop).toBe(true);

    await harness.unmount();
  });

  test("scrollToTop stays at the top through native scroll and resize events", async () => {
    const hiddenRowsAfterReveal = 25;
    const rows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP + hiddenRowsAfterReveal,
    );
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      expect(container.style.overflowAnchor).toBe("none");
      await flush();
      await dispatchScroll(container);
      triggerResizeObservers();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(container.scrollTop).toBe(0);
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("near-bottom scroll from the first window selects the next row window", async () => {
    const hiddenRowsAfterSecondReveal = 25;
    const rows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP * 2 + hiddenRowsAfterSecondReveal,
    );
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);

    await act(async () => {
      container.scrollTop = getMaxScrollTop(container);
      await dispatchPointerDown(container);
      await dispatchScroll(container);
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_STEP);
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(container.scrollTop).toBeLessThan(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("repeated scrollToTop stays on the first bounded row window", async () => {
    const rows = createSingleTurnRows(1_000);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        harness.getLatestResult().scrollToTop();
        await flush();
      });

      expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);
      expect(harness.getLatestResult().windowStart).toBe(0);
    }

    expect(harness.getLatestResult().isNearTop).toBe(true);

    await harness.unmount();
  });

  test("near-top scroll selects the previous row window", async () => {
    const hiddenRowsAfterReveal = 25;
    const rows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP + hiddenRowsAfterReveal,
    );
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_STEP);
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(container.scrollTop).toBeGreaterThanOrEqual(0);

    await harness.unmount();
  });

  test("scrollToBottom collapses row-expanded single-turn transcripts back to the latest rows", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP + 25);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
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
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);

    await act(async () => {
      harness.getLatestResult().scrollToBottom();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(rows.length - AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("bottom of an older row window is not the logical transcript bottom", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP + 25);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
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
    container.scrollTop = getMaxScrollTop(container);
    await act(async () => {
      await dispatchScroll(container);
    });

    expect(harness.getLatestResult().windowStart).not.toBe(
      rows.length - AGENT_CHAT_ROW_WINDOW_SIZE,
    );
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("scrollToBottomOnSend from an older row window selects latest and pins bottom", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP + 25);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
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
    container.scrollTop = getMaxScrollTop(container);

    await act(async () => {
      harness.getLatestResult().scrollToBottomOnSend();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(rows.length - AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("keeps the latest row budget when an oversized single-turn transcript appends", async () => {
    const initialRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + 25);
    const nextRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + 50);
    const harness = await mountHarness(
      {
        rows: initialRows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
        isSessionWorking: true,
      },
      { attachDom: true },
    );

    await harness.update({
      rows: nextRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
      isSessionWorking: true,
    });

    expect(harness.getLatestResult().windowStart).toBe(
      nextRows.length - AGENT_CHAT_ROW_WINDOW_SIZE,
    );
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);

    await harness.unmount();
  });

  test("advances to the new latest row window when rows append while following latest", async () => {
    const initialRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + 25);
    const nextRows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP + 25,
    );
    const harness = await mountHarness({
      rows: initialRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(25);

    await harness.update({
      rows: nextRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(
      nextRows.length - AGENT_CHAT_ROW_WINDOW_SIZE,
    );

    await harness.unmount();
  });

  test("does not advance to latest when rows append while viewing an older row window", async () => {
    const initialRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + 25);
    const nextRows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP + 25,
    );
    const harness = await mountHarness({
      rows: initialRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });
    expect(harness.getLatestResult().windowStart).toBe(0);

    await harness.update({
      rows: nextRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(0);

    await harness.unmount();
  });

  test("does not advance to latest when rows append after user scrolls within latest window", async () => {
    const initialRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + 25);
    const nextRows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP + 25,
    );
    const harness = await mountHarness(
      {
        rows: initialRows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );
    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    expect(harness.getLatestResult().windowStart).toBe(25);
    container.scrollTop = 1_000;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });

    await harness.update({
      rows: nextRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_STEP);
    expect(harness.getLatestResult().windowStart).not.toBe(
      nextRows.length - AGENT_CHAT_ROW_WINDOW_SIZE,
    );

    await harness.unmount();
  });

  test("fills hidden history until the transcript overflows", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
      },
      {
        attachDom: true,
        containerClientHeight: 900,
      },
    );

    await act(async () => {
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);

    await harness.unmount();
  });

  test("scrolling near the top on a short transcript keeps the only row window", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(container.scrollTop).toBeGreaterThanOrEqual(0);

    await harness.unmount();
  });

  test("fast upward scrolling keeps short transcripts in the only row window", async () => {
    const rows = createTurnRows(20);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(container.scrollTop).toBeGreaterThanOrEqual(0);

    await harness.unmount();
  });

  test("scrollToTop reveals the full transcript and moves to top", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    expect(container.style.overflowAnchor).toBe("auto");

    await harness.unmount();
  });

  test("recomputes top and bottom edge visibility after scrolling away from the top", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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

  test("keeps the latest row window on the first populated render after an empty frame", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness({
      rows: [],
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: true,
    });

    expect(harness.getLatestResult().windowStart).toBe(0);

    await harness.update({
      rows,
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(0);

    await harness.unmount();
  });

  test("switching sessions after selecting first history resets the next session to its latest row window", async () => {
    const firstSessionRows = createTurnRows(12, "session-1");
    const secondSessionRows = createTurnRows(12, "session-2");
    const harness = await mountHarness(
      {
        rows: firstSessionRows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);

    await harness.update({
      rows: secondSessionRows,
      displayedSessionKey: "session-2",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(0);

    await harness.unmount();
  });

  test("switching sessions clears manual scroll state so late-rendered content stays pinned", async () => {
    const firstSessionRows = createTurnRows(12, "session-1");
    const secondSessionRows = createTurnRows(12, "session-2");
    const extraContentHeightPx = { current: 0 };
    const harness = await mountHarness(
      {
        rows: firstSessionRows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.update({
      rows: secondSessionRows,
      displayedSessionKey: "session-2",
      shouldResetForTranscriptLoad: false,
    });

    extraContentHeightPx.current = 200;
    await act(async () => {
      triggerResizeObservers();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(true);
    expect(container.style.overflowAnchor).toBe("none");
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("late session content after a switch stays pinned through content growth", async () => {
    const firstSessionRows = createTurnRows(12, "session-1");
    const secondSessionRows = createTurnRows(12, "session-2");
    const extraContentHeightPx = { current: 0 };
    const harness = await mountHarness(
      {
        rows: firstSessionRows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.update({
      rows: [],
      displayedSessionKey: "session-2",
      shouldResetForTranscriptLoad: true,
    });

    await harness.update({
      rows: secondSessionRows,
      displayedSessionKey: "session-2",
      shouldResetForTranscriptLoad: false,
    });

    extraContentHeightPx.current = 200;
    await act(async () => {
      triggerResizeObservers();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(true);
    expect(container.style.overflowAnchor).toBe("none");
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("scrollToBottom selects the latest row window and jumps to bottom", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    await act(async () => {
      harness.getLatestResult().scrollToBottom();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("ignores non-user scroll restoration while following the transcript", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = Math.floor(getMaxScrollTop(container) / 2);
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
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    extraContentHeightPx.current = 200;
    await act(async () => {
      triggerResizeObservers();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(false);
    expect(container.scrollTop).toBe(120);

    await harness.unmount();
  });

  test("keeps the bottom locked while streaming when the user stays pinned", async () => {
    const rows = createTurnRows(4);
    const extraContentHeightPx = { current: 0 };
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

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
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    await act(async () => {
      harness.getLatestResult().scrollToBottomOnSend();
      await flush();
    });

    await harness.update({
      rows: nextRows,
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
      isSessionWorking: true,
    });
    await act(async () => {
      triggerResizeObservers();
      await flush();
    });
    await animationFrameDriver.flushFrames();

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
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(true);
    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("scrollToBottomOnSend keeps full history expanded when already at the bottom", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    container.scrollTop = getMaxScrollTop(container);
    await act(async () => {
      await dispatchScroll(container);
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);

    await act(async () => {
      harness.getLatestResult().scrollToBottomOnSend();
      await flush();
    });
    await animationFrameDriver.flushFrames();

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
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    extraContentHeightPx.current = 200;
    await act(async () => {
      syncBottomAfterComposerLayoutRef.current?.();
      await flush();
    });
    await animationFrameDriver.flushFrames();

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
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
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
    await animationFrameDriver.flushFrames();

    extraContentHeightPx.current = 200;
    await act(async () => {
      syncBottomAfterComposerLayoutRef.current?.();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(container.scrollTop).toBe(120);
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("exports the expected row-window constants", () => {
    expect(AGENT_CHAT_ROW_WINDOW_SIZE).toBe(240);
    expect(AGENT_CHAT_ROW_WINDOW_STEP).toBe(160);
  });
});
