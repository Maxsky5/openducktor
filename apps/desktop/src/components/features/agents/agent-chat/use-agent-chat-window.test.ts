import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, createRef } from "react";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { CHAT_OVERSCAN, CHAT_SHIFT_SIZE, CHAT_WINDOW_SIZE } from "./agent-chat-thread-windowing";
import { useAgentChatWindow } from "./use-agent-chat-window";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessProps = {
  rows: AgentChatWindowRow[];
  activeSessionId: string | null;
  isSessionViewLoading: boolean;
  isSessionWorking?: boolean;
  syncBottomAfterComposerLayoutRef?: { current: (() => void) | null };
};

type HookResult = ReturnType<typeof useAgentChatWindow>;

type MockScrollTo = (options: ScrollToOptions) => void;

type MockMessagesContainer = HTMLDivElement & {
  scrollTo: ReturnType<typeof mock<MockScrollTo>>;
  addEventListener: ReturnType<typeof mock<HTMLDivElement["addEventListener"]>>;
  removeEventListener: ReturnType<typeof mock<HTMLDivElement["removeEventListener"]>>;
  getBoundingClientRect: ReturnType<typeof mock<HTMLDivElement["getBoundingClientRect"]>>;
  querySelectorAll: ReturnType<typeof mock<HTMLDivElement["querySelectorAll"]>>;
};

type MockMessagesContent = HTMLDivElement & {
  scrollHeight: number;
};

type TriggerableIntersectionObserver = IntersectionObserver & {
  trigger: (entries?: Partial<IntersectionObserverEntry>[]) => void;
};

const createRows = (count: number): AgentChatWindowRow[] =>
  Array.from({ length: count }, (_, i) => ({
    kind: "message" as const,
    key: `session-1:msg-${i}`,
    message: {
      id: `msg-${i}`,
      role: "assistant" as const,
      content: `Message ${i}`,
      timestamp: "2026-02-20T10:01:00.000Z",
      meta: {
        kind: "assistant" as const,
        agentRole: "spec" as const,
        isFinal: true,
        profileId: "Hephaestus (Deep Agent)",
        durationMs: 1000,
      },
    },
  }));

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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

const setRefCurrent = <T>(ref: { current: T | null }, value: T | null): void => {
  ref.current = value;
};

const createMessagesContainer = (): MockMessagesContainer => {
  const container = {
    addEventListener: mock<HTMLDivElement["addEventListener"]>(() => undefined),
    clientHeight: 300,
    getBoundingClientRect: mock<HTMLDivElement["getBoundingClientRect"]>(
      () => ({ top: 0 }) as DOMRect,
    ),
    querySelectorAll: mock<HTMLDivElement["querySelectorAll"]>(
      () => [] as unknown as NodeListOf<Element>,
    ),
    removeEventListener: mock<HTMLDivElement["removeEventListener"]>(() => undefined),
    scrollHeight: 1000,
    scrollTo: mock<MockScrollTo>(() => undefined),
    scrollTop: 700,
  };

  return container as unknown as MockMessagesContainer;
};

const createMessagesContent = (): MockMessagesContent => {
  return {
    scrollHeight: 1000,
  } as unknown as MockMessagesContent;
};

const ROW_HEIGHT_PX = 40;

const attachWindowedRowGeometry = ({
  container,
  rows,
  getWindowStart,
  getWindowEnd,
}: {
  container: MockMessagesContainer;
  rows: AgentChatWindowRow[];
  getWindowStart: () => number;
  getWindowEnd: () => number;
}): void => {
  container.querySelectorAll.mockImplementation(() => {
    const windowStart = getWindowStart();
    const windowEnd = getWindowEnd();
    const rowElements = rows.slice(windowStart, windowEnd + 1).map((row, index) => {
      return {
        dataset: { rowKey: row.key },
        getBoundingClientRect: () =>
          ({
            top: index * ROW_HEIGHT_PX,
          }) as DOMRect,
      } as unknown as HTMLElement;
    });

    return rowElements as unknown as ReturnType<HTMLDivElement["querySelectorAll"]>;
  });
};

const attachScrollableWindowedRowGeometry = ({
  container,
  rows,
  getWindowStart,
  getWindowEnd,
  getRowHeight,
}: {
  container: MockMessagesContainer;
  rows: AgentChatWindowRow[];
  getWindowStart: () => number;
  getWindowEnd: () => number;
  getRowHeight: (row: AgentChatWindowRow, index: number) => number;
}): void => {
  container.querySelectorAll.mockImplementation(() => {
    const windowStart = getWindowStart();
    const windowEnd = getWindowEnd();
    let accumulatedTop = 0;
    const rowElements = rows.slice(windowStart, windowEnd + 1).map((row, index) => {
      const rowHeight = getRowHeight(row, windowStart + index);
      const top = accumulatedTop - container.scrollTop;
      accumulatedTop += rowHeight;
      return {
        dataset: { rowKey: row.key },
        getBoundingClientRect: () =>
          ({
            top,
            bottom: top + rowHeight,
          }) as DOMRect,
      } as unknown as HTMLElement;
    });

    return rowElements as unknown as ReturnType<HTMLDivElement["querySelectorAll"]>;
  });
};

const getLatestResult = (latestResultRef: { current: HookResult | null }): HookResult => {
  const result = latestResultRef.current;
  if (!result) {
    throw new Error("Expected hook result to be available");
  }

  return result;
};

const mountHarness = async (
  props: HarnessProps,
  options?: {
    attachContainer?: boolean;
    attachContent?: boolean;
    containerFactory?: () => MockMessagesContainer;
    contentFactory?: () => MockMessagesContent;
  },
): Promise<{
  getLatestResult: () => HookResult;
  messagesContainerRef: ReturnType<typeof createHarness>["messagesContainerRef"];
  messagesContentRef: ReturnType<typeof createHarness>["messagesContentRef"];
  update: (nextProps: HarnessProps) => Promise<void>;
  unmount: () => Promise<void>;
}> => {
  const resolvedOptions = options ?? {};
  const { latestResultRef, messagesContainerRef, messagesContentRef } = createHarness();
  const shouldAttachContent =
    resolvedOptions.attachContent ?? resolvedOptions.attachContainer ?? false;
  if (resolvedOptions.attachContainer) {
    setRefCurrent(
      messagesContainerRef,
      resolvedOptions.containerFactory?.() ?? createMessagesContainer(),
    );
  }
  if (shouldAttachContent) {
    setRefCurrent(
      messagesContentRef,
      resolvedOptions.contentFactory?.() ?? createMessagesContent(),
    );
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

const mockIntersectionObservers: TriggerableIntersectionObserver[] = [];
type MockResizeObserverController = {
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
  observedElements: Set<Element>;
};

const mockResizeObserverControllers = new Set<MockResizeObserverController>();

class MockIntersectionObserver implements TriggerableIntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;

  private readonly callback: IntersectionObserverCallback;
  private observedElements = new Set<Element>();

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "";
    if (Array.isArray(options.threshold)) {
      this.thresholds = options.threshold;
    } else if (typeof options.threshold === "number") {
      this.thresholds = [options.threshold];
    } else {
      this.thresholds = [0];
    }
    mockIntersectionObservers.push(this);
  }

  disconnect(): void {
    this.observedElements = new Set<Element>();
  }

  observe(target: Element): void {
    this.observedElements.add(target);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element): void {
    this.observedElements.delete(target);
  }

  trigger(entries: Partial<IntersectionObserverEntry>[] = [{ isIntersecting: true }]): void {
    const fallbackTarget = createMessagesContainer() as unknown as Element;
    const observedTargets = Array.from(this.observedElements);
    const resolvedEntries = entries.map((entry, index) => {
      return {
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRatio: entry.isIntersecting ? 1 : 0,
        intersectionRect: {} as DOMRectReadOnly,
        isIntersecting: entry.isIntersecting ?? false,
        rootBounds: null,
        target: observedTargets[index] ?? fallbackTarget,
        time: 0,
        ...entry,
      } as IntersectionObserverEntry;
    });

    this.callback(resolvedEntries, this);
  }
}

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
  for (const controller of [...mockResizeObserverControllers]) {
    if (controller.observedElements.size === 0) {
      continue;
    }

    controller.callback(
      Array.from(controller.observedElements).map((target) => {
        return {
          borderBoxSize: [] as ResizeObserverSize[],
          contentBoxSize: [] as ResizeObserverSize[],
          contentRect: {} as DOMRectReadOnly,
          devicePixelContentBoxSize: [] as ResizeObserverSize[],
          target,
        } satisfies ResizeObserverEntry;
      }),
      controller.observer,
    );
  }
};

describe("useAgentChatWindow", () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    mockIntersectionObservers.length = 0;
    mockResizeObserverControllers.clear();
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver;
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    if (typeof originalWindow === "undefined") {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  test("returns an empty window for empty rows", async () => {
    const harness = await mountHarness({
      rows: [],
      activeSessionId: null,
      isSessionViewLoading: false,
    });

    const result = harness.getLatestResult();
    expect(result.windowedRows).toEqual([]);
    expect(result.windowStart).toBe(0);
    expect(result.windowEnd).toBe(-1);
    expect(result.isNearBottom).toBe(true);
    expect(result.isNearTop).toBe(true);

    await harness.unmount();
  });

  test("returns all rows when the list is smaller than the window size", async () => {
    const rows = createRows(25);
    const harness = await mountHarness({
      rows,
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const result = harness.getLatestResult();
    expect(result.windowedRows).toEqual(rows);
    expect(result.windowStart).toBe(0);
    expect(result.windowEnd).toBe(rows.length - 1);

    await harness.unmount();
  });

  test("starts with a bottom-anchored window when rows exceed the window size", async () => {
    const rows = createRows(80);
    const harness = await mountHarness({
      rows,
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(Math.max(0, rows.length - CHAT_WINDOW_SIZE - CHAT_OVERSCAN));
    expect(result.windowEnd).toBe(rows.length - 1);
    expect(result.windowedRows).toEqual(rows.slice(result.windowStart, result.windowEnd + 1));

    await harness.unmount();
  });

  test("starts pinned to the bottom", async () => {
    const harness = await mountHarness({
      rows: createRows(80),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const result = harness.getLatestResult();
    expect(result.isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("resets to the bottom-anchored window when the active session changes", async () => {
    const harness = await mountHarness({
      rows: createRows(80),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });

    const nextRows = createRows(95);
    await harness.update({
      rows: nextRows,
      activeSessionId: "session-2",
      isSessionViewLoading: false,
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(
      Math.max(0, nextRows.length - CHAT_WINDOW_SIZE - CHAT_OVERSCAN),
    );
    expect(result.windowEnd).toBe(nextRows.length - 1);
    expect(result.isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("scrolls the container to bottom on first mount with an already-active session", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: container.scrollHeight,
      behavior: "auto",
    });

    await harness.unmount();
  });

  test("scrolls the container to bottom when the active session changes", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as
      | (MockMessagesContainer & { scrollHeight: number })
      | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTo.mockClear();

    await harness.update({
      rows: createRows(95),
      activeSessionId: "session-2",
      isSessionViewLoading: false,
    });

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: container.scrollHeight,
      behavior: "auto",
    });

    await harness.unmount();
  });

  test("extends the window when row count increases while pinned to bottom", async () => {
    const harness = await mountHarness({
      rows: createRows(80),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const nextRows = createRows(81);
    await harness.update({
      rows: nextRows,
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(21);
    expect(result.windowEnd).toBe(80);
    expect(result.windowedRows.at(-1)).toEqual(nextRows.at(-1));

    await harness.unmount();
  });

  test("animates pinned auto-scroll to the live bottom over half a second when rows are appended", async () => {
    (globalThis as { window?: unknown }).window = globalThis;
    const queuedFrameCallbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      queuedFrameCallbacks.push(callback);
      return queuedFrameCallbacks.length;
    }) as typeof requestAnimationFrame;

    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    queuedFrameCallbacks.length = 0;

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 700;
    Object.assign(container, { scrollHeight: 1100 });

    await harness.update({
      rows: createRows(81),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const frameAtStart = queuedFrameCallbacks.shift();
    if (!frameAtStart) {
      throw new Error("Expected initial animation frame");
    }

    await act(async () => {
      frameAtStart(0);
      await flush();
    });

    expect(container.scrollTop).toBe(700);

    Object.assign(container, { scrollHeight: 1250 });

    const frameAtHalfway = queuedFrameCallbacks.shift();
    if (!frameAtHalfway) {
      throw new Error("Expected midpoint animation frame");
    }

    await act(async () => {
      frameAtHalfway(250);
      await flush();
    });

    expect(container.scrollTop).toBeGreaterThan(700);
    expect(container.scrollTop).toBeLessThan(950);

    const frameAtEnd = queuedFrameCallbacks.shift();
    if (!frameAtEnd) {
      throw new Error("Expected animation completion frame");
    }

    await act(async () => {
      frameAtEnd(500);
      await flush();
    });

    expect(container.scrollTop).toBe(950);

    const result = harness.getLatestResult();
    expect(result.isAutoFollowingToBottom).toBe(false);

    await harness.unmount();
  });

  test("does not auto-follow live appends after upward wheel intent within the bottom threshold", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    const wheelListenerCall = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "wheel")
      .at(-1);
    const wheelListener = wheelListenerCall?.[1];
    if (typeof wheelListener !== "function") {
      throw new Error("Expected wheel listener");
    }

    await act(async () => {
      wheelListener({ deltaY: -24 } as WheelEvent);
      await flush();
    });

    container.scrollTo.mockClear();

    await harness.update({
      rows: createRows(81),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
      isSessionWorking: true,
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(20);
    expect(result.windowEnd).toBe(79);
    const lastRow = result.windowedRows.at(-1);
    if (!lastRow || lastRow.kind !== "message") {
      throw new Error("Expected the final window row to be a message");
    }
    expect(lastRow.message.id).toBe("msg-79");
    expect(container.scrollTo).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("ignores upward wheel intent for idle sessions", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    const wheelListenerCall = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "wheel")
      .at(-1);
    const wheelListener = wheelListenerCall?.[1];
    if (typeof wheelListener !== "function") {
      throw new Error("Expected wheel listener");
    }

    await act(async () => {
      wheelListener({ deltaY: -24 } as WheelEvent);
      await flush();
    });

    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("does not bottom-sync content growth after live auto-follow is disabled", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    const content = harness.messagesContentRef.current as MockMessagesContent | null;
    if (!container || !content) {
      throw new Error("Expected messages container and content");
    }

    const wheelListenerCall = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "wheel")
      .at(-1);
    const wheelListener = wheelListenerCall?.[1];
    if (typeof wheelListener !== "function") {
      throw new Error("Expected wheel listener");
    }

    await act(async () => {
      wheelListener({ deltaY: -24 } as WheelEvent);
      await flush();
    });

    container.scrollTo.mockClear();
    Object.assign(content, { scrollHeight: 1240 });
    Object.assign(container, { scrollHeight: 1240 });

    await act(async () => {
      triggerResizeObservers();
      await flush();
    });

    expect(container.scrollTo).not.toHaveBeenCalled();
    expect(harness.getLatestResult().isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("does not auto-follow the first idle append after live follow was disabled", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    const wheelListenerCall = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "wheel")
      .at(-1);
    const wheelListener = wheelListenerCall?.[1];
    if (typeof wheelListener !== "function") {
      throw new Error("Expected wheel listener");
    }

    await act(async () => {
      wheelListener({ deltaY: -24 } as WheelEvent);
      await flush();
    });

    container.scrollTo.mockClear();

    await harness.update({
      rows: createRows(81),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
      isSessionWorking: false,
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(20);
    expect(result.windowEnd).toBe(79);
    const lastRow = result.windowedRows.at(-1);
    if (!lastRow || lastRow.kind !== "message") {
      throw new Error("Expected the final window row to be a message");
    }
    expect(lastRow.message.id).toBe("msg-79");
    expect(container.scrollTo).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("re-arms live follow when the user scrolls back to bottom after the run becomes idle", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    const wheelListenerCall = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "wheel")
      .at(-1);
    const wheelListener = wheelListenerCall?.[1];
    if (typeof wheelListener !== "function") {
      throw new Error("Expected wheel listener");
    }

    const scrollListenerCall = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "scroll")
      .at(-1);
    const scrollListener = scrollListenerCall?.[1];
    if (typeof scrollListener !== "function") {
      throw new Error("Expected scroll listener");
    }

    await act(async () => {
      wheelListener({ deltaY: -24 } as WheelEvent);
      await flush();
    });

    await harness.update({
      rows: createRows(80),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
      isSessionWorking: false,
    });

    container.scrollTop = 620;
    await act(async () => {
      scrollListener(new Event("scroll"));
      await flush();
    });

    container.scrollTop = 700;
    await act(async () => {
      scrollListener(new Event("scroll"));
      await flush();
    });

    await harness.update({
      rows: createRows(81),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
      isSessionWorking: true,
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(21);
    expect(result.windowEnd).toBe(80);
    const lastRow = result.windowedRows.at(-1);
    if (!lastRow || lastRow.kind !== "message") {
      throw new Error("Expected the final window row to be a message");
    }
    expect(lastRow.message.id).toBe("msg-80");

    await harness.unmount();
  });

  test("preserves the visible viewport when a tall rendered message above it grows", async () => {
    const rows = createRows(80);
    const rowHeights = new Map<number, number>();
    rowHeights.set(20, 120);

    const harness = await mountHarness(
      {
        rows,
        activeSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    const content = harness.messagesContentRef.current as MockMessagesContent | null;
    if (!container || !content) {
      throw new Error("Expected messages container and content");
    }

    attachScrollableWindowedRowGeometry({
      container,
      rows,
      getWindowStart: () => harness.getLatestResult().windowStart,
      getWindowEnd: () => harness.getLatestResult().windowEnd,
      getRowHeight: (_row, index) => rowHeights.get(index) ?? ROW_HEIGHT_PX,
    });

    const scrollListenerCall = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "scroll")
      .at(-1);
    const scrollListener = scrollListenerCall?.[1];
    if (typeof scrollListener !== "function") {
      throw new Error("Expected scroll listener");
    }

    container.scrollTop = 300;
    await act(async () => {
      scrollListener(new Event("scroll"));
      await flush();
    });

    container.scrollTo.mockClear();
    rowHeights.set(20, 320);
    Object.assign(content, { scrollHeight: 1200 });
    Object.assign(container, { scrollHeight: 1200 });

    await act(async () => {
      triggerResizeObservers();
      await flush();
    });

    expect(container.scrollTop).toBe(500);
    expect(container.scrollTo).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("does not cancel appended auto-follow when scroll events come from the animation itself", async () => {
    (globalThis as { window?: unknown }).window = globalThis;
    const queuedFrameCallbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      queuedFrameCallbacks.push(callback);
      return queuedFrameCallbacks.length;
    }) as typeof requestAnimationFrame;

    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    queuedFrameCallbacks.length = 0;

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 700;
    Object.assign(container, { scrollHeight: 1100 });

    await harness.update({
      rows: createRows(81),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const scrollListenerCalls = container.addEventListener.mock.calls.filter(
      ([eventName]) => eventName === "scroll",
    );
    const latestScrollListener = scrollListenerCalls.at(-1)?.[1];
    if (typeof latestScrollListener !== "function") {
      throw new Error("Expected scroll listener");
    }

    const frameAtStart = queuedFrameCallbacks.shift();
    if (!frameAtStart) {
      throw new Error("Expected initial animation frame");
    }

    await act(async () => {
      frameAtStart(0);
      await flush();
    });

    container.scrollTop = 780;
    await act(async () => {
      latestScrollListener(new Event("scroll"));
      await flush();
    });

    expect(harness.getLatestResult().isAutoFollowingToBottom).toBe(true);

    const frameAtHalfway = queuedFrameCallbacks.shift();
    if (!frameAtHalfway) {
      throw new Error("Expected midpoint animation frame");
    }

    Object.assign(container, { scrollHeight: 1250 });
    await act(async () => {
      frameAtHalfway(250);
      await flush();
    });

    expect(container.scrollTop).toBeGreaterThan(780);
    expect(harness.getLatestResult().isAutoFollowingToBottom).toBe(true);

    const frameAtEnd = queuedFrameCallbacks.shift();
    if (!frameAtEnd) {
      throw new Error("Expected animation completion frame");
    }

    await act(async () => {
      frameAtEnd(500);
      await flush();
    });

    expect(container.scrollTop).toBe(950);
    expect(harness.getLatestResult().isAutoFollowingToBottom).toBe(false);

    await harness.unmount();
  });

  test("does not restart live bottom follow after the user interrupts an append animation", async () => {
    (globalThis as { window?: unknown }).window = globalThis;
    const queuedFrameCallbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      queuedFrameCallbacks.push(callback);
      return queuedFrameCallbacks.length;
    }) as typeof requestAnimationFrame;

    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
        isSessionWorking: true,
      },
      { attachContainer: true },
    );

    queuedFrameCallbacks.length = 0;

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 700;
    Object.assign(container, { scrollHeight: 1100 });

    await harness.update({
      rows: createRows(81),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
      isSessionWorking: true,
    });

    expect(queuedFrameCallbacks.length).toBeGreaterThan(0);

    const wheelListeners = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "wheel")
      .map(([, listener]) => listener)
      .filter((listener): listener is EventListener => typeof listener === "function");
    if (wheelListeners.length === 0) {
      throw new Error("Expected wheel listeners");
    }

    await act(async () => {
      for (const wheelListener of wheelListeners) {
        wheelListener({ deltaY: -24 } as WheelEvent);
      }
      await flush();
    });

    queuedFrameCallbacks.length = 0;
    container.scrollTo.mockClear();

    await harness.update({
      rows: createRows(82),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
      isSessionWorking: true,
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(21);
    expect(result.windowEnd).toBe(80);
    expect(queuedFrameCallbacks).toHaveLength(0);
    expect(container.scrollTo).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("keeps the viewport anchored to the bottom when content height grows while pinned", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    const content = harness.messagesContentRef.current as MockMessagesContent | null;
    if (!container || !content) {
      throw new Error("Expected messages container and content");
    }

    container.scrollTo.mockClear();
    Object.assign(content, { scrollHeight: 1240 });
    Object.assign(container, { scrollHeight: 1240 });

    await act(async () => {
      triggerResizeObservers();
      await flush();
    });

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: 1240,
      behavior: "auto",
    });

    const result = harness.getLatestResult();
    expect(result.isNearBottom).toBe(true);
    expect(result.isNearTop).toBe(false);

    await harness.unmount();
  });

  test("keeps the viewport anchored to the bottom when container height shrinks while pinned", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as
      | (MockMessagesContainer & { clientHeight: number })
      | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTo.mockClear();
    Object.assign(container, { clientHeight: 220 });

    await act(async () => {
      triggerResizeObservers();
      await flush();
    });

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: container.scrollHeight,
      behavior: "auto",
    });

    const result = harness.getLatestResult();
    expect(result.isNearBottom).toBe(true);
    expect(result.isNearTop).toBe(false);

    await harness.unmount();
  });

  test("does not preserve bottom pinning on the initial scroll sample when the container starts away from bottom", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: null,
        isSessionViewLoading: false,
      },
      {
        attachContainer: true,
        containerFactory: () => {
          const container = createMessagesContainer();
          container.scrollTop = 500;
          return container;
        },
      },
    );

    await act(async () => {
      await flush();
    });

    expect(harness.getLatestResult().isNearBottom).toBe(false);
    expect(harness.getLatestResult().isNearTop).toBe(false);

    await harness.unmount();
  });

  test("keeps bottom pinning sticky after the user scrolls back to bottom before composer resize", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as
      | (MockMessagesContainer & { clientHeight: number })
      | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    const latestScrollListenerCall = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "scroll")
      .at(-1);
    const latestScrollListener = latestScrollListenerCall?.[1];
    if (typeof latestScrollListener !== "function") {
      throw new Error("Expected scroll listener");
    }

    container.scrollTop = 500;
    await act(async () => {
      latestScrollListener(new Event("scroll"));
      await flush();
    });

    expect(harness.getLatestResult().isNearBottom).toBe(false);

    container.scrollTop = container.scrollHeight - container.clientHeight;
    await act(async () => {
      latestScrollListener(new Event("scroll"));
      await flush();
    });

    expect(harness.getLatestResult().isNearBottom).toBe(true);

    container.scrollTo.mockClear();
    Object.assign(container, { clientHeight: 220 });

    await act(async () => {
      latestScrollListener(new Event("scroll"));
      await flush();
    });

    await act(async () => {
      triggerResizeObservers();
      await flush();
    });

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: container.scrollHeight,
      behavior: "auto",
    });
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("restores bottom pinning after a composer-layout sync when transient scroll drift breaks bottom threshold", async () => {
    const syncBottomAfterComposerLayoutRef = { current: null } as { current: (() => void) | null };
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
        syncBottomAfterComposerLayoutRef,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as
      | (MockMessagesContainer & { clientHeight: number })
      | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    const latestScrollListenerCall = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "scroll")
      .at(-1);
    const latestScrollListener = latestScrollListenerCall?.[1];
    if (typeof latestScrollListener !== "function") {
      throw new Error("Expected scroll listener");
    }

    container.scrollTo.mockClear();
    Object.assign(container, {
      scrollTop: 660,
      clientHeight: 220,
    });

    const syncBottomAfterComposerLayout = syncBottomAfterComposerLayoutRef.current;
    if (typeof syncBottomAfterComposerLayout !== "function") {
      throw new Error("Expected composer layout sync callback");
    }

    await act(async () => {
      latestScrollListener(new Event("scroll"));
      syncBottomAfterComposerLayout();
      await flush();
    });

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: container.scrollHeight,
      behavior: "auto",
    });
    expect(harness.getLatestResult().isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("cancels composer-layout sync when the user starts scrolling during the settle window", async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const queuedFrameCallbacks: FrameRequestCallback[] = [];

    try {
      globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        queuedFrameCallbacks.push(callback);
        return queuedFrameCallbacks.length;
      }) as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;

      const syncBottomAfterComposerLayoutRef = { current: null } as {
        current: (() => void) | null;
      };
      const harness = await mountHarness(
        {
          rows: createRows(80),
          activeSessionId: "session-1",
          isSessionViewLoading: false,
          syncBottomAfterComposerLayoutRef,
        },
        { attachContainer: true },
      );

      const container = harness.messagesContainerRef.current as
        | (MockMessagesContainer & { clientHeight: number })
        | null;
      if (!container) {
        throw new Error("Expected messages container");
      }

      const latestScrollListenerCall = container.addEventListener.mock.calls
        .filter(([eventName]) => eventName === "scroll")
        .at(-1);
      const latestScrollListener = latestScrollListenerCall?.[1];
      if (typeof latestScrollListener !== "function") {
        throw new Error("Expected scroll listener");
      }

      const userScrollIntentListenerCall = container.addEventListener.mock.calls
        .filter(([eventName]) => eventName === "wheel")
        .at(-1);
      const userScrollIntentListener = userScrollIntentListenerCall?.[1];
      if (typeof userScrollIntentListener !== "function") {
        throw new Error("Expected user scroll intent listener");
      }

      container.scrollTo.mockClear();
      Object.assign(container, {
        scrollTop: 660,
        clientHeight: 220,
      });

      const syncBottomAfterComposerLayout = syncBottomAfterComposerLayoutRef.current;
      if (typeof syncBottomAfterComposerLayout !== "function") {
        throw new Error("Expected composer layout sync callback");
      }

      await act(async () => {
        latestScrollListener(new Event("scroll"));
        syncBottomAfterComposerLayout();
      });

      const firstSettleFrame = queuedFrameCallbacks.shift();
      if (!firstSettleFrame) {
        throw new Error("Expected first settle frame");
      }

      await act(async () => {
        firstSettleFrame(0);
      });

      const secondSettleFrame = queuedFrameCallbacks.shift();
      if (!secondSettleFrame) {
        throw new Error("Expected second settle frame");
      }

      await act(async () => {
        userScrollIntentListener(new Event("wheel"));
        secondSettleFrame(16);
        await flush();
      });

      expect(container.scrollTo).not.toHaveBeenCalled();

      await harness.unmount();
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  test("does not auto-scroll to bottom when container height changes while not near bottom", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as
      | (MockMessagesContainer & { clientHeight: number })
      | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    const latestScrollListenerCall = container.addEventListener.mock.calls
      .filter(([eventName]) => eventName === "scroll")
      .at(-1);
    const latestScrollListener = latestScrollListenerCall?.[1];
    if (typeof latestScrollListener !== "function") {
      throw new Error("Expected scroll listener");
    }

    container.scrollTop = 500;
    await act(async () => {
      latestScrollListener(new Event("scroll"));
      await flush();
    });

    container.scrollTo.mockClear();
    Object.assign(container, { clientHeight: 220 });

    await act(async () => {
      triggerResizeObservers();
      await flush();
    });

    expect(container.scrollTo).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("mock resize observers only unobserve the requested target", () => {
    const callback = mock(
      (_entries: ResizeObserverEntry[], _observer: ResizeObserver) => undefined,
    );
    const observer = new MockResizeObserver(callback);
    const firstTarget = createMessagesContainer() as unknown as Element;
    const secondTarget = createMessagesContent() as unknown as Element;

    observer.observe(firstTarget);
    observer.observe(secondTarget);
    observer.unobserve(firstTarget);

    triggerResizeObservers();

    expect(callback).toHaveBeenCalledTimes(1);
    const firstCall = callback.mock.calls[0] as [ResizeObserverEntry[], ResizeObserver] | undefined;
    if (!firstCall) {
      throw new Error("Expected resize observer callback call");
    }

    const entries = firstCall[0];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.target).toBe(secondTarget);

    observer.disconnect();
    callback.mockClear();

    triggerResizeObservers();

    expect(callback).not.toHaveBeenCalled();
  });

  test("rebuilds the bottom window when the row count decreases while pinned", async () => {
    const harness = await mountHarness({
      rows: createRows(80),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const nextRows = createRows(30);
    await harness.update({
      rows: nextRows,
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(0);
    expect(result.windowEnd).toBe(29);
    expect(result.windowedRows).toEqual(nextRows);

    await harness.unmount();
  });

  test("scrollToTop moves the window to the oldest rows", async () => {
    const harness = await mountHarness({
      rows: createRows(80),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(0);
    expect(result.windowEnd).toBe(Math.min(79, CHAT_WINDOW_SIZE + CHAT_OVERSCAN - 1));
    expect(result.isNearTop).toBe(true);
    expect(result.isNearBottom).toBe(false);

    await harness.unmount();
  });

  test("scrollToTop jumps to the container top without smooth scrolling", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTo.mockClear();

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "auto",
    });

    await harness.unmount();
  });

  test("scrollToTop suppresses bottom sentinel shifts until the unlock frame", async () => {
    (globalThis as { window?: unknown }).window = globalThis;
    const queuedFrameCallbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      queuedFrameCallbacks.push(callback);
      return queuedFrameCallbacks.length;
    }) as typeof requestAnimationFrame;

    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });

    const sentinelElement = createMessagesContainer();
    await act(async () => {
      harness.getLatestResult().bottomSentinelRef(sentinelElement);
      await flush();
    });

    const observer = mockIntersectionObservers.at(-1);
    if (!observer) {
      throw new Error("Expected bottom sentinel observer");
    }

    await act(async () => {
      observer.trigger([{ isIntersecting: true }]);
      await flush();
    });

    let result = harness.getLatestResult();
    expect(result.windowStart).toBe(0);
    expect(result.windowEnd).toBe(Math.min(79, CHAT_WINDOW_SIZE + CHAT_OVERSCAN - 1));

    const unlockSentinels = queuedFrameCallbacks.shift();
    if (!unlockSentinels) {
      throw new Error("Expected queued unlock frame");
    }

    await act(async () => {
      unlockSentinels(0);
      await flush();
    });

    await act(async () => {
      observer.trigger([{ isIntersecting: true }]);
      await flush();
    });

    result = harness.getLatestResult();
    expect(result.windowStart).toBe(0);
    expect(result.windowEnd).toBe(69);

    await harness.unmount();
  });

  test("scrollToBottom restores the bottom-anchored window", async () => {
    const harness = await mountHarness({
      rows: createRows(80),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });

    await act(async () => {
      harness.getLatestResult().scrollToBottom();
      await flush();
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(20);
    expect(result.windowEnd).toBe(79);
    expect(result.isNearBottom).toBe(true);

    await harness.unmount();
  });

  test("scrollToBottom jumps to the container bottom without smooth scrolling", async () => {
    const harness = await mountHarness(
      {
        rows: createRows(80),
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });

    container.scrollTo.mockClear();

    await act(async () => {
      harness.getLatestResult().scrollToBottom();
      await flush();
    });

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: container.scrollHeight,
      behavior: "auto",
    });

    await harness.unmount();
  });

  test("jumps to bottom without animation when session history loading settles", async () => {
    const harness = await mountHarness(
      {
        rows: [],
        activeSessionId: "session-1",
        isSessionViewLoading: true,
      },
      { attachContainer: true, attachContent: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    const content = harness.messagesContentRef.current as MockMessagesContent | null;
    if (!container || !content) {
      throw new Error("Expected messages container and content");
    }

    container.scrollTo.mockClear();
    Object.assign(content, { scrollHeight: 1600 });
    Object.assign(container, { scrollHeight: 1600 });

    await harness.update({
      rows: createRows(80),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: 1600,
      behavior: "auto",
    });

    await harness.unmount();
  });

  test("preserves the viewport anchor when older history is prepended into the window", async () => {
    const rows = createRows(120);
    const harness = await mountHarness(
      {
        rows,
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    attachWindowedRowGeometry({
      container,
      rows,
      getWindowStart: () => harness.getLatestResult().windowStart,
      getWindowEnd: () => harness.getLatestResult().windowEnd,
    });
    container.scrollTop = 160;

    const sentinelElement = createMessagesContainer();
    await act(async () => {
      harness.getLatestResult().topSentinelRef(sentinelElement);
      await flush();
    });

    const observer = mockIntersectionObservers.at(-1);
    if (!observer) {
      throw new Error("Expected top sentinel observer");
    }

    await act(async () => {
      observer.trigger([{ isIntersecting: true }]);
      await flush();
    });

    expect(harness.getLatestResult().windowStart).toBe(50);
    expect(container.scrollTop).toBe(160 + CHAT_SHIFT_SIZE * ROW_HEIGHT_PX);

    await harness.unmount();
  });

  test("preserves the viewport anchor when newer history replaces rows above the viewport", async () => {
    const rows = createRows(120);
    const harness = await mountHarness(
      {
        rows,
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachContainer: true },
    );

    const container = harness.messagesContainerRef.current as MockMessagesContainer | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    attachWindowedRowGeometry({
      container,
      rows,
      getWindowStart: () => harness.getLatestResult().windowStart,
      getWindowEnd: () => harness.getLatestResult().windowEnd,
    });

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });

    container.scrollTop = 600;

    const sentinelElement = createMessagesContainer();
    await act(async () => {
      harness.getLatestResult().bottomSentinelRef(sentinelElement);
      await flush();
    });

    const observer = mockIntersectionObservers.at(-1);
    if (!observer) {
      throw new Error("Expected bottom sentinel observer");
    }

    await act(async () => {
      observer.trigger([{ isIntersecting: true }]);
      await flush();
    });

    await act(async () => {
      observer.trigger([{ isIntersecting: true }]);
      await flush();
    });

    expect(harness.getLatestResult().windowStart).toBe(10);
    expect(container.scrollTop).toBe(600 - 10 * ROW_HEIGHT_PX);

    await harness.unmount();
  });

  test("returns windowedRows as the active slice", async () => {
    const rows = createRows(95);
    const harness = await mountHarness({
      rows,
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const result = harness.getLatestResult();
    expect(result.windowedRows).toEqual(rows.slice(result.windowStart, result.windowEnd + 1));

    await harness.unmount();
  });

  test("exports the expected chat window constants", () => {
    expect(CHAT_WINDOW_SIZE).toBe(50);
    expect(CHAT_OVERSCAN).toBe(10);
    expect(CHAT_SHIFT_SIZE).toBe(10);
  });
});
