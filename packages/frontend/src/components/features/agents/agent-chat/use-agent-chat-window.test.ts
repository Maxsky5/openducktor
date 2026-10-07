import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, createRef } from "react";
import { createAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { installReactActEnvironment } from "@/test-utils/react-act-environment";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT,
  AGENT_CHAT_ROW_WINDOW_SIZE,
} from "./agent-chat-row-windows";
import type { AgentChatTranscriptRow } from "./agent-chat-transcript-model";
import { buildAgentChatTurnAnchors } from "./agent-chat-transcript-model";
import { revealElement } from "@/lib/reveal-element";
import { useAgentChatWindow } from "./use-agent-chat-window";

interface LatestResultRefContract {
  current: HookResult | null;
}

type HarnessProps = {
  rows: AgentChatTranscriptRow[];
  turnAnchors?: ReturnType<typeof buildAgentChatTurnAnchors>;
  displayedSessionKey: string | null;
  shouldResetForTranscriptLoad: boolean;
};

type HookResult = ReturnType<typeof useAgentChatWindow>;

type MockResizeObserverController = {
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
  observedElements: Set<Element>;
};

const ROW_HEIGHT_PX = 40;
const MAX_MOUNTED_ROW_COUNT = AGENT_CHAT_ROW_WINDOW_SIZE * 3;
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

const triggerResizeObservers = (targetElement?: Element): void => {
  for (const controller of mockResizeObserverControllers) {
    if (controller.observedElements.size === 0) {
      continue;
    }

    const observedElements = targetElement
      ? Array.from(controller.observedElements).filter((target) => target === targetElement)
      : Array.from(controller.observedElements);
    if (observedElements.length === 0) {
      continue;
    }

    const entries: ResizeObserverEntry[] = observedElements.map((target) => ({
      borderBoxSize: [],
      contentBoxSize: [],
      contentRect: new DOMRect(),
      devicePixelContentBoxSize: [],
      target,
    }));
    controller.callback(entries, controller.observer);
  }
};

const createTurnRows = (
  turnCount: number,
  externalSessionId = "session-1",
): AgentChatTranscriptRow[] =>
  Array.from({ length: turnCount }, (_, turnIndex): AgentChatTranscriptRow[] => [
    {
      kind: "message",
      key: `${externalSessionId}:user-${turnIndex}`,
      message: {
        id: `user-${turnIndex}`,
        role: "user",
        content: `Question ${turnIndex}`,
        timestamp: "2026-02-20T10:01:00.000Z",
      },
    },
    {
      kind: "message",
      key: `${externalSessionId}:assistant-${turnIndex}`,
      message: {
        id: `assistant-${turnIndex}`,
        role: "assistant",
        content: `Answer ${turnIndex}`,
        timestamp: "2026-02-20T10:01:01.000Z",
        meta: {
          kind: "assistant",
          agentRole: "spec",
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
        kind: "message",
        key: `${externalSessionId}:user-0`,
        message: {
          id: "user-0",
          role: "user",
          content: "Question",
          timestamp: "2026-02-20T10:01:00.000Z",
        },
      };
    }

    return {
      kind: "message",
      key: `${externalSessionId}:assistant-${rowIndex}`,
      message: {
        id: `assistant-${rowIndex}`,
        role: "assistant",
        content: `Answer chunk ${rowIndex}`,
        timestamp: "2026-02-20T10:01:01.000Z",
        meta: {
          kind: "assistant",
          agentRole: "spec",
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
  const latestResultRef: LatestResultRefContract = { current: null };

  const Harness = (props: HarnessProps): null => {
    const hookInput: Parameters<typeof useAgentChatWindow>[0] = {
      ...props,
      turnAnchors: props.turnAnchors ?? buildAgentChatTurnAnchors(props.rows),
      messagesContainerRef,
      messagesContentRef,
    };
    const result = useAgentChatWindow(hookInput);
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
    getRowHeightPx?: (row: AgentChatTranscriptRow) => number;
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
  const getRowHeightPx = options?.getRowHeightPx ?? (() => rowHeightPx);

  if (options?.attachDom) {
    const container = document.createElement("div");
    const content = document.createElement("div");
    let scrollTopValue = 0;
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      get: () => options?.containerClientHeight ?? 300,
    });
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: container.clientHeight,
        height: container.clientHeight,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      get: () =>
        getLatestResult(latestResultRef).visibleRows.reduce(
          (height, row) => height + getRowHeightPx(row),
          0,
        ) + extraContentHeightPx.current,
    });
    // Like a browser layout, a read clamps the position when the scroll range gets smaller.
    const clampScrollTop = (value: number): number =>
      Math.max(0, Math.min(value, getMaxScrollTop(container)));
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => {
        scrollTopValue = clampScrollTop(scrollTopValue);
        return scrollTopValue;
      },
      set: (value: number) => {
        scrollTopValue = clampScrollTop(value);
      },
    });

    container.appendChild(content);
    messagesContainerRef.current = container;
    messagesContentRef.current = content;
  }

  const harness = createSharedHookHarness((nextProps: HarnessProps) => {
    const hookInput: Parameters<typeof useAgentChatWindow>[0] = {
      ...nextProps,
      turnAnchors: nextProps.turnAnchors ?? buildAgentChatTurnAnchors(nextProps.rows),
      messagesContainerRef,
      messagesContentRef,
    };
    const result = useAgentChatWindow(hookInput);
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

const mountPinnedTranscript = async () => {
  const extraContentHeightPx = { current: 0 };
  const harness = await mountHarness(
    {
      rows: createTurnRows(8),
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
    },
    { attachDom: true, extraContentHeightPx },
  );
  const container = harness.messagesContainerRef.current;
  if (!container) {
    throw new Error("Expected messages container");
  }
  return { harness, container, extraContentHeightPx };
};

const renderMountedRowElements = (
  harness: Awaited<ReturnType<typeof mountHarness>>,
  rowHeightPx = ROW_HEIGHT_PX,
): void => {
  const container = harness.messagesContainerRef.current;
  const content = harness.messagesContentRef.current;
  if (!container || !content) {
    throw new Error("Expected mounted row DOM");
  }

  content.replaceChildren();
  harness.getLatestResult().visibleRows.forEach((row, rowIndex) => {
    const element = document.createElement("div");
    element.dataset.rowKey = row.key;
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const top = rowIndex * rowHeightPx - container.scrollTop;
        return {
          bottom: top + rowHeightPx,
          height: rowHeightPx,
          left: 0,
          right: 0,
          top,
          width: 0,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      },
    });
    content.appendChild(element);
  });
};

const dispatchWheelUp = async (container: HTMLDivElement): Promise<void> => {
  container.dispatchEvent(new WheelEvent("wheel", { deltaY: -24 }));
  await flush();
};

const dispatchWheelDown = async (container: HTMLDivElement): Promise<void> => {
  container.dispatchEvent(new WheelEvent("wheel", { deltaY: 24 }));
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

const dispatchPointerUp = async (): Promise<void> => {
  document.dispatchEvent(new PointerEvent("pointerup"));
  await flush();
};

const dispatchKeyDown = async (target: EventTarget, key: string): Promise<void> => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await flush();
};

const growContent = async (extraContentHeightPx: { current: number }): Promise<void> => {
  extraContentHeightPx.current += 200;
  await act(async () => {
    triggerResizeObservers();
    await flush();
  });
};

describe("useAgentChatWindow", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  let restoreReactActEnvironment = (): void => {};

  beforeEach(() => {
    restoreReactActEnvironment = installReactActEnvironment();
    mockResizeObserverControllers.clear();
    globalThis.ResizeObserver = MockResizeObserver;
    animationFrameDriver.install();
  });

  afterEach(() => {
    restoreReactActEnvironment();
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

  test("keeps the same visible row and anchor references when the window inputs are unchanged", async () => {
    const rows = createTurnRows(12);
    const turnAnchors = buildAgentChatTurnAnchors(rows);
    const harness = await mountHarness({
      rows,
      turnAnchors,
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
    });

    const initialWindowedRows = harness.getLatestResult().visibleRows;
    const initialVisibleTurnAnchors = harness.getLatestResult().visibleTurnAnchors;

    await harness.update({
      rows,
      turnAnchors,
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().visibleRows).toBe(initialWindowedRows);
    expect(harness.getLatestResult().visibleTurnAnchors).toBe(initialVisibleTurnAnchors);

    await harness.unmount();
  });

  test("keeps scroll action references stable when inputs are unchanged", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness({
      rows,
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
    });

    const initialResult = harness.getLatestResult();

    await harness.update({
      rows,
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().scrollToTop).toBe(initialResult.scrollToTop);
    expect(harness.getLatestResult().scrollToBottom).toBe(initialResult.scrollToBottom);

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
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_SIZE + hiddenRowsAfterReveal,
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

  test("fills a larger viewport so the user can keep scrolling", async () => {
    const rows = createSingleTurnRows(160);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );
    const container = harness.messagesContainerRef.current;
    if (!container) throw new Error("Expected messages container");
    try {
      await act(async () => {
        triggerResizeObservers(container);
      });
      expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);
      Object.defineProperty(container, "clientHeight", { configurable: true, value: 2000 });
      await act(async () => {
        triggerResizeObservers(container);
      });
      expect(harness.getLatestResult().visibleRows.length).toBeGreaterThan(
        AGENT_CHAT_ROW_WINDOW_SIZE,
      );
      expect(harness.getLatestResult().visibleRows.at(-1)).toBe(rows.at(-1));
      expect(getMaxScrollTop(container)).toBeGreaterThan(0);
    } finally {
      await harness.unmount();
    }
  });

  test("underfilled first history range appends rows until the user can keep scrolling", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 3);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      {
        attachDom: true,
        containerClientHeight: AGENT_CHAT_ROW_WINDOW_SIZE,
        rowHeightPx: 1,
      },
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
    expect(harness.getLatestResult().visibleRows.length).toBeGreaterThan(
      AGENT_CHAT_ROW_WINDOW_SIZE,
    );
    expect(harness.getLatestResult().visibleRows.at(-1)?.key).toBe(rows.at(-1)?.key);
    expect(getMaxScrollTop(container)).toBeGreaterThan(0);

    await harness.unmount();
  });

  test("underfilled history mounting stays within the bounded row budget", async () => {
    const rows = createSingleTurnRows(MAX_MOUNTED_ROW_COUNT + AGENT_CHAT_ROW_WINDOW_SIZE);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      {
        attachDom: true,
        containerClientHeight: 500,
        rowHeightPx: 1,
      },
    );

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);
    expect(harness.getLatestResult().visibleRows.at(-1)?.key).toBe(
      rows[MAX_MOUNTED_ROW_COUNT - 1]?.key,
    );
    expect(harness.getLatestResult().visibleRows).not.toContainEqual(
      expect.objectContaining({ key: rows.at(-1)?.key }),
    );

    await harness.unmount();
  });

  test("scrollToTop stays at the top through native scroll and resize events", async () => {
    const hiddenRowsAfterReveal = 25;
    const rows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_SIZE + hiddenRowsAfterReveal,
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

  test("native scroll near the bottom appends the next row batch without replacing visible rows", async () => {
    const hiddenRowsAfterSecondReveal = 25;
    const rows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_SIZE * 2 + hiddenRowsAfterSecondReveal,
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

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE * 2);
    expect(harness.getLatestResult().visibleRows[0]?.key).toBe(rows[0]?.key);
    expect(harness.getLatestResult().visibleRows.at(-1)?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE * 2 - 1]?.key,
    );
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(container.scrollTop).toBeLessThan(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("native scroll near the bottom slides the mounted range and unmounts older top rows", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6);
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

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        container.scrollTop = getMaxScrollTop(container);
        await dispatchPointerDown(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
    }

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);
    expect(harness.getLatestResult().visibleRows[0]?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE]?.key,
    );
    expect(harness.getLatestResult().visibleRows).not.toContainEqual(
      expect.objectContaining({ key: rows[0]?.key }),
    );
    expect(harness.getLatestResult().visibleRows.at(-1)?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE * 4 - 1]?.key,
    );

    await harness.unmount();
  });

  test("downward trim-top keeps the visible rows in place when it removes more height than remains below", async () => {
    const tallRowHeightPx = 200;
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6);
    const tallRowKeys = new Set(rows.slice(0, AGENT_CHAT_ROW_WINDOW_SIZE).map((row) => row.key));
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      {
        attachDom: true,
        getRowHeightPx: (row) => (tallRowKeys.has(row.key) ? tallRowHeightPx : ROW_HEIGHT_PX),
      },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    const scrollToMountedBottom = async (): Promise<void> => {
      await act(async () => {
        container.scrollTop = getMaxScrollTop(container);
        await dispatchPointerDown(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
    };

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });
    await animationFrameDriver.flushFrames();
    await scrollToMountedBottom();
    await scrollToMountedBottom();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);

    // The trimmed top rows are taller than the appended rows and the rows below the viewport,
    // so the scroll range after the trim ends above the scroll position before the trim.
    const scrollTopBeforeTrim = getMaxScrollTop(container);
    await scrollToMountedBottom();

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(getMaxScrollTop(container)).toBeLessThan(scrollTopBeforeTrim);
    expect(container.scrollTop).toBe(
      scrollTopBeforeTrim - AGENT_CHAT_ROW_WINDOW_SIZE * tallRowHeightPx,
    );

    await harness.unmount();
  });

  test("scrollToTop from a slid row window selects the first window and pins top with one click", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6);
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

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        container.scrollTop = getMaxScrollTop(container);
        await dispatchPointerDown(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
    }

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(container.scrollTop).toBeGreaterThan(0);

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(harness.getLatestResult().visibleRows[0]?.key).toBe(rows[0]?.key);
    expect(container.scrollTop).toBe(0);
    expect(harness.getLatestResult().isNearTop).toBe(true);

    await harness.unmount();
  });

  test("scrolling toward the mounted bottom preloads the next rows before the physical edge", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6);
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

    for (let index = 0; index < 2; index += 1) {
      await act(async () => {
        container.scrollTop = getMaxScrollTop(container);
        await dispatchPointerDown(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
    }

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);

    renderMountedRowElements(harness);
    const preloadScrollTop =
      (MAX_MOUNTED_ROW_COUNT - AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT - 1) * ROW_HEIGHT_PX -
      container.clientHeight +
      ROW_HEIGHT_PX / 2;
    expect(preloadScrollTop).toBeLessThan(getMaxScrollTop(container));

    await act(async () => {
      container.scrollTop = preloadScrollTop;
      await dispatchPointerDown(container);
      await dispatchScroll(container);
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);
    expect(harness.getLatestResult().visibleRows[0]?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE]?.key,
    );
    expect(harness.getLatestResult().visibleRows.at(-1)?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE * 4 - 1]?.key,
    );
    expect(harness.getLatestResult().visibleRows).not.toContainEqual(
      expect.objectContaining({ key: rows[0]?.key }),
    );
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(container.scrollTop).toBeLessThan(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("physical mounted-bottom expansion does not restore auto-follow on resize", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6);
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );

    const container = harness.messagesContainerRef.current;
    const content = harness.messagesContentRef.current;
    if (!container || !content) {
      throw new Error("Expected messages DOM");
    }

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    for (let index = 0; index < 2; index += 1) {
      await act(async () => {
        container.scrollTop = getMaxScrollTop(container);
        await dispatchPointerDown(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
    }

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);

    await act(async () => {
      container.scrollTop = getMaxScrollTop(container);
      await dispatchPointerDown(container);
      await dispatchScroll(container);
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);
    const preservedScrollTop = container.scrollTop;
    expect(preservedScrollTop).toBeGreaterThan(0);
    expect(preservedScrollTop).toBeLessThan(getMaxScrollTop(container));

    await act(async () => {
      triggerResizeObservers(content);
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(container.scrollTop).toBe(preservedScrollTop);
    expect(container.scrollTop).toBeLessThan(getMaxScrollTop(container));
    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE);

    await harness.unmount();
  });

  test("appended rows keep the same mounted anchor after bottom-scroll trim-top slides", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6);
    const appendedRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6 + 10);
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

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        container.scrollTop = getMaxScrollTop(container);
        await dispatchPointerDown(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
    }

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);

    await harness.update({
      rows: appendedRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);
    expect(harness.getLatestResult().visibleRows[0]?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE]?.key,
    );
    expect(harness.getLatestResult().visibleRows.at(-1)?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE * 4 - 1]?.key,
    );

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

  test("native scroll near the top prepends the previous row batch without dropping current rows", async () => {
    const hiddenRowsAfterReveal = 25;
    const rows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_SIZE + hiddenRowsAfterReveal,
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

    const previousFirstVisibleKey = harness.getLatestResult().visibleRows[0]?.key;

    container.scrollTop = 160;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(
      rows.length - AGENT_CHAT_ROW_WINDOW_SIZE * 2,
    );
    expect(harness.getLatestResult().visibleRows).toHaveLength(AGENT_CHAT_ROW_WINDOW_SIZE * 2);
    expect(harness.getLatestResult().visibleRows).toContainEqual(
      expect.objectContaining({ key: previousFirstVisibleKey }),
    );
    expect(container.scrollTop).toBeGreaterThanOrEqual(0);

    await harness.unmount();
  });

  test("native scroll near the top slides the mounted range and unmounts newer bottom rows", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6);
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

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        container.scrollTop = 0;
        await dispatchWheelUp(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
    }

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE * 2);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);
    expect(harness.getLatestResult().visibleRows[0]?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE * 2]?.key,
    );
    expect(harness.getLatestResult().visibleRows.at(-1)?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE * 5 - 1]?.key,
    );
    expect(harness.getLatestResult().visibleRows).not.toContainEqual(
      expect.objectContaining({ key: rows.at(-1)?.key }),
    );
    expect(container.scrollTop).toBeGreaterThan(0);

    await harness.unmount();
  });

  test("scrolling toward the mounted top preloads previous rows before the physical edge", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6);
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

    for (let index = 0; index < 2; index += 1) {
      await act(async () => {
        container.scrollTop = 0;
        await dispatchWheelUp(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
    }

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE * 3);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);

    renderMountedRowElements(harness);

    await act(async () => {
      container.scrollTop = (AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT + 10) * ROW_HEIGHT_PX;
      await dispatchScroll(container);
      container.scrollTop =
        AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT * ROW_HEIGHT_PX - ROW_HEIGHT_PX / 2;
      expect(container.scrollTop).toBeGreaterThan(0);
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE * 2);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);
    expect(harness.getLatestResult().visibleRows[0]?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE * 2]?.key,
    );
    expect(harness.getLatestResult().visibleRows.at(-1)?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE * 5 - 1]?.key,
    );
    expect(harness.getLatestResult().visibleRows).not.toContainEqual(
      expect.objectContaining({ key: rows.at(-1)?.key }),
    );
    expect(container.scrollTop).toBeGreaterThan(0);

    await harness.unmount();
  });

  test("appended rows keep the same mounted anchor after upward trim-bottom slides", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6);
    const appendedRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 6 + 10);
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

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        container.scrollTop = 0;
        await dispatchWheelUp(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
    }

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE * 2);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);

    await harness.update({
      rows: appendedRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(AGENT_CHAT_ROW_WINDOW_SIZE * 2);
    expect(harness.getLatestResult().visibleRows).toHaveLength(MAX_MOUNTED_ROW_COUNT);
    expect(harness.getLatestResult().visibleRows[0]?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE * 2]?.key,
    );
    expect(harness.getLatestResult().visibleRows.at(-1)?.key).toBe(
      rows[AGENT_CHAT_ROW_WINDOW_SIZE * 5 - 1]?.key,
    );

    await harness.unmount();
  });

  test("scrollToBottom collapses row-expanded single-turn transcripts back to the latest rows", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_SIZE + 25);
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

  test("bottom of an older stable row window is not the logical transcript bottom", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_SIZE + 25);
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
    await act(async () => {
      await dispatchPointerDown(container);
      container.scrollTop = getMaxScrollTop(container);
      await dispatchScroll(container);
    });
    await act(async () => {
      await dispatchScroll(container);
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("scrollToBottom from the bottom of an older row window selects latest and pins bottom", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_SIZE + 25);
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
    await act(async () => {
      await dispatchPointerDown(container);
      container.scrollTop = getMaxScrollTop(container);
      await dispatchScroll(container);
    });

    await act(async () => {
      harness.getLatestResult().scrollToBottom();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(rows.length - AGENT_CHAT_ROW_WINDOW_SIZE);
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("keeps a pinned transcript at the bottom when appended rows advance the row window", async () => {
    const initialRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 2);
    const nextRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 2 + 15);
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

    await harness.update({
      rows: nextRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(
      nextRows.length - AGENT_CHAT_ROW_WINDOW_SIZE,
    );
    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("restores the bottom when the browser moves a pinned transcript after a click", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE * 2);
    const extraContentHeightPx = { current: 0 };
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true, extraContentHeightPx },
    );

    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    await act(async () => {
      await dispatchPointerDown(container);
      await dispatchPointerUp();
    });

    await act(async () => {
      extraContentHeightPx.current = ROW_HEIGHT_PX * 8;
      container.scrollTop = 0;
      await dispatchScroll(container);
    });

    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

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
      },
      { attachDom: true },
    );

    await harness.update({
      rows: nextRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
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
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_SIZE + 25,
    );
    const harness = await mountHarness(
      {
        rows: initialRows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );

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
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_SIZE + 25,
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

  test("keeps the selected row window anchored when rows append after user scrolls within latest window", async () => {
    const initialRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + 25);
    const nextRows = createSingleTurnRows(
      AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_SIZE + 25,
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

    expect(harness.getLatestResult().windowStart).toBe(25);
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

  test("pins a cached readonly modal transcript to the physical bottom on mount", async () => {
    const rows = createTurnRows(20, "child-session");
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "child-session",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );
    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("pins an asynchronously loaded readonly modal transcript to the physical bottom", async () => {
    const rows = createTurnRows(20, "child-session");
    const harness = await mountHarness(
      {
        rows: [],
        displayedSessionKey: "child-session",
        shouldResetForTranscriptLoad: true,
      },
      { attachDom: true },
    );
    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    await harness.update({
      rows,
      displayedSessionKey: "child-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("keeps following the latest row window after a large transcript reset", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + 60);
    const appendedRows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + 61);
    const harness = await mountHarness({
      rows: [],
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: true,
    });

    await harness.update({
      rows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(60);

    await harness.update({
      rows: appendedRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().windowStart).toBe(61);

    await harness.unmount();
  });

  test("preserves the first visible row when history is prepended while not following", async () => {
    const rows = createSingleTurnRows(AGENT_CHAT_ROW_WINDOW_SIZE + 60);
    const prependedRows = [...createSingleTurnRows(10, "history-session"), ...rows];
    const harness = await mountHarness(
      {
        rows,
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );
    const firstVisibleRowKey = harness.getLatestResult().visibleRows[0]?.key;
    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 260;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });
    await animationFrameDriver.flushFrames();

    await harness.update({
      rows: prependedRows,
      displayedSessionKey: "single-turn-session",
      shouldResetForTranscriptLoad: false,
    });

    expect(harness.getLatestResult().visibleRows[0]?.key).toBe(firstVisibleRowKey);
    expect(harness.getLatestResult().windowStart).toBe(70);

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

  test("switching large sessions exposes the next latest row window on its first render", async () => {
    const firstSessionRows = createTurnRows(50, "session-1");
    const secondSessionRows = createTurnRows(60, "session-2");
    const observedResults: HookResult[] = [];
    const messagesContainerRef = createRef<HTMLDivElement>();
    const messagesContentRef = createRef<HTMLDivElement>();
    const harness = createSharedHookHarness(
      (props: HarnessProps) => {
        const result = useAgentChatWindow({
          ...props,
          turnAnchors: props.turnAnchors ?? buildAgentChatTurnAnchors(props.rows),
          messagesContainerRef,
          messagesContentRef,
        });
        observedResults.push(result);
        return result;
      },
      {
        rows: firstSessionRows,
        displayedSessionKey: "session-1",
        shouldResetForTranscriptLoad: false,
      },
    );
    await harness.mount();
    await harness.run((result) => result.scrollToTop());
    const observationsBeforeSwitch = observedResults.length;

    await harness.update({
      rows: secondSessionRows,
      displayedSessionKey: "session-2",
      shouldResetForTranscriptLoad: false,
    });

    const firstSwitchedRender = observedResults[observationsBeforeSwitch];
    const expectedStart = secondSessionRows.length - AGENT_CHAT_ROW_WINDOW_SIZE;
    expect(firstSwitchedRender?.windowStart).toBe(expectedStart);
    expect(firstSwitchedRender?.visibleRows[0]).toBe(secondSessionRows[expectedStart]);

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
      harness.getLatestResult().scrollToBottom();
      await flush();
    });

    await harness.update({
      rows: nextRows,
      displayedSessionKey: "session-1",
      shouldResetForTranscriptLoad: false,
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

  test("scrollToBottom pins the transcript again after the user scrolls up", async () => {
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

    container.scrollTop = 40;
    await act(async () => {
      await dispatchWheelUp(container);
      await dispatchScroll(container);
    });

    await act(async () => {
      harness.getLatestResult().scrollToBottom();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().isNearBottom).toBe(true);
    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("scrollToBottom keeps full history expanded when it is also the latest row window", async () => {
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

    container.scrollTop = getMaxScrollTop(container);
    await act(async () => {
      await dispatchScroll(container);
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);

    await act(async () => {
      harness.getLatestResult().scrollToBottom();
      await flush();
    });
    await animationFrameDriver.flushFrames();

    expect(harness.getLatestResult().windowStart).toBe(0);
    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("keeps a pinned transcript at the bottom when the chat area shrinks", async () => {
    const { harness, container } = await mountPinnedTranscript();

    Object.defineProperty(container, "clientHeight", { configurable: true, value: 150 });
    await act(async () => {
      triggerResizeObservers(container);
      await flush();
    });

    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("keeps the reading position when the chat area shrinks after the user scrolls up", async () => {
    const { harness, container } = await mountPinnedTranscript();

    await act(async () => {
      await dispatchWheelUp(container);
      container.scrollTop = 120;
      await dispatchScroll(container);
    });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 150 });
    await act(async () => {
      triggerResizeObservers(container);
      await flush();
    });

    expect(container.scrollTop).toBe(120);
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("keeps following content growth during a click that does not scroll up", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();

    await act(async () => {
      await dispatchPointerDown(container);
    });
    extraContentHeightPx.current += 200;
    await act(async () => {
      await dispatchScroll(container);
    });
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("keeps following content growth when the content gets smaller during a pointer press", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();
    extraContentHeightPx.current = 200;
    await act(async () => {
      triggerResizeObservers();
      await flush();
    });

    await act(async () => {
      await dispatchPointerDown(container);
      // The browser clamps the scroll position to the new bottom edge.
      extraContentHeightPx.current = 0;
      container.scrollTop = getMaxScrollTop(container);
      await dispatchScroll(container);
      await dispatchPointerUp();
    });
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("stops following content growth after an upward pointer drag", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();

    await act(async () => {
      await dispatchPointerDown(container);
      container.scrollTop = 120;
      await dispatchScroll(container);
      await dispatchPointerUp();
    });
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(120);
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("stops following content growth after an upward touch drag", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();

    await act(async () => {
      container.dispatchEvent(new Event("touchstart"));
      // A touch pan cancels its pointer before the scroll starts.
      document.dispatchEvent(new PointerEvent("pointercancel", { pointerType: "touch" }));
      container.scrollTop = 120;
      await dispatchScroll(container);
      document.dispatchEvent(new Event("touchend"));
      await flush();
    });
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(120);

    await harness.unmount();
  });

  test("stops following content growth after a scroll-up key in the transcript", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();

    document.body.appendChild(container);

    try {
      await act(async () => {
        await dispatchKeyDown(container, "PageUp");
        container.scrollTop = 120;
        await dispatchScroll(container);
      });
      await growContent(extraContentHeightPx);

      expect(container.scrollTop).toBe(120);
    } finally {
      container.remove();
      await harness.unmount();
    }
  });

  test("keeps following content growth after a scroll-up key that a component handles", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();
    const list = document.createElement("div");
    list.addEventListener("keydown", (event) => event.preventDefault());
    container.appendChild(list);
    document.body.appendChild(container);

    try {
      await act(async () => {
        await dispatchKeyDown(list, "ArrowUp");
      });
      await growContent(extraContentHeightPx);

      expect(container.scrollTop).toBe(getMaxScrollTop(container));
    } finally {
      container.remove();
      await harness.unmount();
    }
  });

  test("keeps following content growth after a scroll-up key in an editable field", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();
    const textarea = document.createElement("textarea");
    container.appendChild(textarea);
    document.body.appendChild(container);

    try {
      await act(async () => {
        await dispatchKeyDown(textarea, "ArrowUp");
      });
      await growContent(extraContentHeightPx);

      expect(container.scrollTop).toBe(getMaxScrollTop(container));
    } finally {
      container.remove();
      await harness.unmount();
    }
  });

  test("a scroll-up key on the page body unpins only after a click in the transcript", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();
    document.body.appendChild(container);

    try {
      await act(async () => {
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await dispatchPointerUp();
        await dispatchKeyDown(document.body, "PageUp");
      });
      await growContent(extraContentHeightPx);

      expect(container.scrollTop).toBe(getMaxScrollTop(container));

      await act(async () => {
        container.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await dispatchPointerUp();
        await dispatchKeyDown(document.body, "PageUp");
        container.scrollTop = 120;
        await dispatchScroll(container);
      });
      await growContent(extraContentHeightPx);

      expect(container.scrollTop).toBe(120);
    } finally {
      container.remove();
      await harness.unmount();
    }
  });

  test("keeps following content growth after a sideways wheel or a wheel inside an inner scroll area", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();
    const innerScrollArea = document.createElement("div");
    Object.defineProperty(innerScrollArea, "scrollTop", { configurable: true, value: 80 });
    container.appendChild(innerScrollArea);

    await act(async () => {
      innerScrollArea.dispatchEvent(new WheelEvent("wheel", { deltaY: -24, bubbles: true }));
      container.dispatchEvent(new WheelEvent("wheel", { deltaX: -40, deltaY: -4 }));
      await flush();
    });
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("stops following content growth after keyboard focus scrolls up to an element", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();
    const button = document.createElement("button");
    container.appendChild(button);

    await act(async () => {
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await act(async () => {
      // The browser scrolls the focused element into view before the focusin event.
      container.scrollTop = 120;
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await dispatchScroll(container);
    });
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(120);

    await harness.unmount();
  });

  test("keeps following content growth after a pointer press that focuses an element", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();
    const button = document.createElement("button");
    container.appendChild(button);

    await act(async () => {
      await dispatchPointerDown(container);
      container.scrollTop = 120;
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await dispatchPointerUp();
    });
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("stops following content growth after a request to reveal an element", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();
    const errorCard = document.createElement("article");
    errorCard.scrollIntoView = () => {};
    container.appendChild(errorCard);

    await act(async () => {
      revealElement(errorCard);
      container.scrollTop = 120;
      await dispatchScroll(container);
    });
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(120);

    await harness.unmount();
  });

  test("pins again when an unpinned transcript stops overflowing", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();

    await act(async () => {
      await dispatchWheelUp(container);
      container.scrollTop = 120;
      await dispatchScroll(container);
    });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 5_000 });
    await act(async () => {
      triggerResizeObservers(container);
      await flush();
    });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 300 });
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await harness.unmount();
  });

  test("pins again only when the user scrolls down to the bottom", async () => {
    const { harness, container, extraContentHeightPx } = await mountPinnedTranscript();

    await act(async () => {
      await dispatchWheelUp(container);
      container.scrollTop = getMaxScrollTop(container) - 20;
      await dispatchScroll(container);
    });
    const smallUpwardScrollTop = container.scrollTop;
    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(smallUpwardScrollTop);

    await act(async () => {
      await dispatchWheelDown(container);
      container.scrollTop = getMaxScrollTop(container) - 10;
      await dispatchScroll(container);
    });

    expect(container.scrollTop).toBe(getMaxScrollTop(container));

    await growContent(extraContentHeightPx);

    expect(container.scrollTop).toBe(getMaxScrollTop(container));
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("exports the expected row-window budget", () => {
    expect(AGENT_CHAT_ROW_WINDOW_SIZE).toBe(40);
  });

  test("navigates 10,000 rows in both directions within the row-window budget", async () => {
    const rows = createSingleTurnRows(10_000);
    const harness = await mountHarness(
      {
        rows,
        turnAnchors: buildAgentChatTurnAnchors(rows),
        displayedSessionKey: "single-turn-session",
        shouldResetForTranscriptLoad: false,
      },
      { attachDom: true },
    );
    const container = harness.messagesContainerRef.current;
    if (!container) {
      throw new Error("Expected messages container");
    }

    const recordVisibleRows = (seen: Set<string>) => {
      const result = harness.getLatestResult();
      expect(result.visibleRows.length).toBeLessThanOrEqual(MAX_MOUNTED_ROW_COUNT);
      for (const row of result.visibleRows) {
        seen.add(row.key);
      }
      return result;
    };

    const seenUp = new Set<string>();
    let result = recordVisibleRows(seenUp);
    expect(result.visibleRows.at(-1)?.key).toBe(rows.at(-1)?.key);
    while (result.windowStart > 0) {
      const previousStart = result.windowStart;
      await act(async () => {
        container.scrollTop = 0;
        await dispatchWheelUp(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
      result = recordVisibleRows(seenUp);
      expect(result.windowStart).toBeLessThan(previousStart);
    }
    expect(result.visibleRows[0]?.key).toBe(rows[0]?.key);
    expect(seenUp.size).toBe(rows.length);

    const seenDown = new Set<string>();
    result = recordVisibleRows(seenDown);
    while (result.visibleRows.at(-1)?.key !== rows.at(-1)?.key) {
      const previousEnd = result.windowStart + result.visibleRows.length;
      await act(async () => {
        container.scrollTop = getMaxScrollTop(container);
        await dispatchPointerDown(container);
        await dispatchScroll(container);
      });
      await animationFrameDriver.flushFrames();
      result = recordVisibleRows(seenDown);
      expect(result.windowStart + result.visibleRows.length).toBeGreaterThan(previousEnd);
    }
    expect(seenDown.size).toBe(rows.length);

    await harness.unmount();
  });
});
