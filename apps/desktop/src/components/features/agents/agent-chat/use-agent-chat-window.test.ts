import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, createRef } from "react";
import TestRenderer, { act } from "react-test-renderer";
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
};

type HookResult = ReturnType<typeof useAgentChatWindow>;

type MockScrollTo = (options: ScrollToOptions) => void;

type MockMessagesContainer = HTMLDivElement & {
  scrollTo: ReturnType<typeof mock<MockScrollTo>>;
  addEventListener: ReturnType<typeof mock<HTMLDivElement["addEventListener"]>>;
  removeEventListener: ReturnType<typeof mock<HTMLDivElement["removeEventListener"]>>;
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
      messagesContainerRef,
      messagesContentRef,
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

const getLatestResult = (latestResultRef: { current: HookResult | null }): HookResult => {
  const result = latestResultRef.current;
  if (!result) {
    throw new Error("Expected hook result to be available");
  }

  return result;
};

const mountHarness = async (
  props: HarnessProps,
  options?: { attachContainer?: boolean; attachContent?: boolean },
): Promise<{
  latestResultRef: { current: HookResult | null };
  messagesContainerRef: ReturnType<typeof createHarness>["messagesContainerRef"];
  messagesContentRef: ReturnType<typeof createHarness>["messagesContentRef"];
  update: (nextProps: HarnessProps) => Promise<void>;
  unmount: () => Promise<void>;
}> => {
  const { Harness, latestResultRef, messagesContainerRef, messagesContentRef } = createHarness();
  const shouldAttachContent = options?.attachContent ?? options?.attachContainer ?? false;
  if (options?.attachContainer) {
    setRefCurrent(messagesContainerRef, createMessagesContainer());
  }
  if (shouldAttachContent) {
    setRefCurrent(messagesContentRef, createMessagesContent());
  }

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(createElement(Harness, props));
    await flush();
  });

  const update = async (nextProps: HarnessProps): Promise<void> => {
    await act(async () => {
      renderer?.update(createElement(Harness, nextProps));
      await flush();
    });
  };

  const unmount = async (): Promise<void> => {
    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  };

  return {
    latestResultRef,
    messagesContainerRef,
    messagesContentRef,
    update,
    unmount,
  };
};

const mockIntersectionObservers: TriggerableIntersectionObserver[] = [];
const mockResizeObserverCallbacks = new Set<ResizeObserverCallback>();

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
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  disconnect(): void {
    mockResizeObserverCallbacks.delete(this.callback);
  }

  observe(_target: Element): void {
    mockResizeObserverCallbacks.add(this.callback);
  }

  unobserve(_target: Element): void {
    mockResizeObserverCallbacks.delete(this.callback);
  }
}

const triggerResizeObservers = (): void => {
  for (const callback of [...mockResizeObserverCallbacks]) {
    callback([], {} as ResizeObserver);
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
    mockResizeObserverCallbacks.clear();
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

    const result = getLatestResult(harness.latestResultRef);
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

    const result = getLatestResult(harness.latestResultRef);
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

    const result = getLatestResult(harness.latestResultRef);
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

    const result = getLatestResult(harness.latestResultRef);
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
      getLatestResult(harness.latestResultRef).scrollToTop();
      await flush();
    });

    const nextRows = createRows(95);
    await harness.update({
      rows: nextRows,
      activeSessionId: "session-2",
      isSessionViewLoading: false,
    });

    const result = getLatestResult(harness.latestResultRef);
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

    const result = getLatestResult(harness.latestResultRef);
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

    const result = getLatestResult(harness.latestResultRef);
    expect(result.isAutoFollowingToBottom).toBe(false);

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

    expect(getLatestResult(harness.latestResultRef).isAutoFollowingToBottom).toBe(true);

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
    expect(getLatestResult(harness.latestResultRef).isAutoFollowingToBottom).toBe(true);

    const frameAtEnd = queuedFrameCallbacks.shift();
    if (!frameAtEnd) {
      throw new Error("Expected animation completion frame");
    }

    await act(async () => {
      frameAtEnd(500);
      await flush();
    });

    expect(container.scrollTop).toBe(950);
    expect(getLatestResult(harness.latestResultRef).isAutoFollowingToBottom).toBe(false);

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

    const result = getLatestResult(harness.latestResultRef);
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

    const result = getLatestResult(harness.latestResultRef);
    expect(result.isNearBottom).toBe(true);
    expect(result.isNearTop).toBe(false);

    await harness.unmount();
  });

  test("clamps the window when the row count decreases", async () => {
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

    const result = getLatestResult(harness.latestResultRef);
    expect(result.windowStart).toBe(20);
    expect(result.windowEnd).toBe(29);
    expect(result.windowedRows).toEqual(nextRows.slice(20, 30));

    await harness.unmount();
  });

  test("scrollToTop moves the window to the oldest rows", async () => {
    const harness = await mountHarness({
      rows: createRows(80),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    await act(async () => {
      getLatestResult(harness.latestResultRef).scrollToTop();
      await flush();
    });

    const result = getLatestResult(harness.latestResultRef);
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
      getLatestResult(harness.latestResultRef).scrollToTop();
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
      getLatestResult(harness.latestResultRef).scrollToTop();
      await flush();
    });

    const sentinelElement = createMessagesContainer();
    await act(async () => {
      getLatestResult(harness.latestResultRef).bottomSentinelRef(sentinelElement);
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

    let result = getLatestResult(harness.latestResultRef);
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

    result = getLatestResult(harness.latestResultRef);
    expect(result.windowStart).toBe(10);
    expect(result.windowEnd).toBe(79);

    await harness.unmount();
  });

  test("scrollToBottom restores the bottom-anchored window", async () => {
    const harness = await mountHarness({
      rows: createRows(80),
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    await act(async () => {
      getLatestResult(harness.latestResultRef).scrollToTop();
      await flush();
    });

    await act(async () => {
      getLatestResult(harness.latestResultRef).scrollToBottom();
      await flush();
    });

    const result = getLatestResult(harness.latestResultRef);
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
      getLatestResult(harness.latestResultRef).scrollToTop();
      await flush();
    });

    container.scrollTo.mockClear();

    await act(async () => {
      getLatestResult(harness.latestResultRef).scrollToBottom();
      await flush();
    });

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: container.scrollHeight,
      behavior: "auto",
    });

    await harness.unmount();
  });

  test("returns windowedRows as the active slice", async () => {
    const rows = createRows(95);
    const harness = await mountHarness({
      rows,
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const result = getLatestResult(harness.latestResultRef);
    expect(result.windowedRows).toEqual(rows.slice(result.windowStart, result.windowEnd + 1));

    await harness.unmount();
  });

  test("exports the expected chat window constants", () => {
    expect(CHAT_WINDOW_SIZE).toBe(50);
    expect(CHAT_OVERSCAN).toBe(10);
    expect(CHAT_SHIFT_SIZE).toBe(20);
  });
});
