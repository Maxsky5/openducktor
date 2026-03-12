import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement, createRef } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useAgentChatAutoScroll } from "./use-agent-chat-auto-scroll";
import { CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET } from "./use-agent-chat-layout";
import type { AgentChatVirtualizer } from "./use-agent-chat-virtualization";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type AutoScrollHarnessProps = {
  activeSessionId: string | null;
  canScrollToLatest: boolean;
  isPinnedToBottom: boolean;
  messagesContainerRef: ReturnType<typeof createRef<HTMLDivElement>>;
  scrollVersion: string;
  shouldVirtualize: boolean;
  virtualRowsCount: number;
  virtualizer: AgentChatVirtualizer;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const getGlobalWindow = (): unknown => {
  const globalWithWindow = globalThis as { window?: unknown };
  return globalWithWindow.window;
};

const setGlobalWindow = (value: unknown): void => {
  const globalWithWindow = globalThis as { window?: unknown };
  if (typeof value === "undefined") {
    delete globalWithWindow.window;
    return;
  }
  globalWithWindow.window = value;
};

const createVirtualizerMock = () => {
  const measure = mock(() => {});
  const scrollToIndex = mock(
    (_index: number, _options: { align: "end"; behavior: "auto" | "smooth" }) => {},
  );
  return {
    measure,
    scrollToIndex,
    virtualizer: {
      measure,
      scrollToIndex,
    } as unknown as AgentChatVirtualizer,
  };
};

const createContainerMock = () => {
  const container = {
    dataset: {},
    clientHeight: 320,
    scrollHeight: 960,
    scrollTop: 480,
  } as unknown as HTMLDivElement & { scrollTop: number };
  const scrollToMock = mock((top: number) => {
    container.scrollTop = top;
  });
  const scrollTo = ((firstArgument?: ScrollToOptions | number, secondArgument?: number) => {
    if (typeof firstArgument === "number") {
      scrollToMock(firstArgument);
      return;
    }
    scrollToMock(Number(firstArgument?.top ?? secondArgument ?? container.scrollTop));
  }) as HTMLDivElement["scrollTo"] & typeof scrollToMock;
  Object.assign(scrollTo, scrollToMock);
  container.scrollTo = scrollTo;
  return { container, scrollTo, scrollToMock };
};

const drainAnimationFrames = (
  rafCallbacks: FrameRequestCallback[],
  options?: { startTimestampMs?: number; stepMs?: number },
): void => {
  let timestampMs = options?.startTimestampMs ?? 0;
  const stepMs = options?.stepMs ?? 16;
  while (rafCallbacks.length > 0) {
    const callback = rafCallbacks.shift();
    if (!callback) {
      return;
    }
    callback(timestampMs);
    timestampMs += stepMs;
  }
};

const AutoScrollHarness = ({
  activeSessionId,
  canScrollToLatest,
  isPinnedToBottom,
  messagesContainerRef,
  scrollVersion,
  shouldVirtualize,
  virtualRowsCount,
  virtualizer,
}: AutoScrollHarnessProps): null => {
  useAgentChatAutoScroll({
    activeSessionId,
    canScrollToLatest,
    isPinnedToBottom,
    messagesContainerRef,
    scrollVersion,
    shouldVirtualize,
    virtualRowsCount,
    virtualizer,
  });
  return null;
};

describe("useAgentChatAutoScroll", () => {
  const originalWindow = getGlobalWindow();

  afterEach(() => {
    setGlobalWindow(originalWindow);
  });

  test("jumps to the bottom on session changes", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const cancelAnimationFrame = mock((_id: number) => {});
    setGlobalWindow({
      cancelAnimationFrame,
      requestAnimationFrame: mock((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      }),
    });

    const { measure, scrollToIndex, virtualizer } = createVirtualizerMock();
    const { container, scrollToMock } = createContainerMock();
    const messagesContainerRef = createRef<HTMLDivElement>();
    messagesContainerRef.current = container;

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: true,
          isPinnedToBottom: true,
          messagesContainerRef,
          scrollVersion: "session-1:1",
          shouldVirtualize: true,
          virtualRowsCount: 4,
          virtualizer,
        }),
      );
      await flush();
    });

    await act(async () => {
      drainAnimationFrames(rafCallbacks);
      await flush();
    });

    expect(measure.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(scrollToIndex).toHaveBeenCalledTimes(0);
    expect(scrollToMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(container.scrollTop).toBe(640);
    expect(messagesContainerRef.current?.dataset[CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET]).toBe("640");

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("jumps to the bottom when the current session becomes scroll-ready again", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const cancelAnimationFrame = mock((_id: number) => {});
    setGlobalWindow({
      cancelAnimationFrame,
      requestAnimationFrame: mock((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      }),
    });

    const { measure, scrollToIndex, virtualizer } = createVirtualizerMock();
    const { container, scrollToMock } = createContainerMock();
    container.scrollTop = 0;
    const messagesContainerRef = createRef<HTMLDivElement>();
    messagesContainerRef.current = container;

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: false,
          isPinnedToBottom: true,
          messagesContainerRef,
          scrollVersion: "session-1:1",
          shouldVirtualize: false,
          virtualRowsCount: 3,
          virtualizer,
        }),
      );
      await flush();
    });

    scrollToMock.mockClear();
    measure.mockClear();

    await act(async () => {
      renderer?.update(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: true,
          isPinnedToBottom: true,
          messagesContainerRef,
          scrollVersion: "session-1:1",
          shouldVirtualize: false,
          virtualRowsCount: 3,
          virtualizer,
        }),
      );
      await flush();
    });

    await act(async () => {
      drainAnimationFrames(rafCallbacks);
      await flush();
    });

    expect(measure).toHaveBeenCalledTimes(0);
    expect(scrollToIndex).toHaveBeenCalledTimes(0);
    expect(scrollToMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(container.scrollTop).toBe(640);
    expect(messagesContainerRef.current?.dataset[CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET]).toBe("640");

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("smooth-scrolls on incremental updates while pinned", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    setGlobalWindow({
      cancelAnimationFrame: mock((_id: number) => {}),
      requestAnimationFrame: mock((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      }),
    });

    const { measure, scrollToIndex, virtualizer } = createVirtualizerMock();
    const { container, scrollToMock } = createContainerMock();
    const messagesContainerRef = createRef<HTMLDivElement>();
    messagesContainerRef.current = container;

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: true,
          isPinnedToBottom: true,
          messagesContainerRef,
          scrollVersion: "session-1:1",
          shouldVirtualize: true,
          virtualRowsCount: 3,
          virtualizer,
        }),
      );
      await flush();
    });

    expect(measure).toHaveBeenCalledTimes(1);
    measure.mockClear();
    scrollToIndex.mockClear();
    scrollToMock.mockClear();
    rafCallbacks.length = 0;
    container.scrollTop = 480;

    await act(async () => {
      renderer?.update(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: true,
          isPinnedToBottom: true,
          messagesContainerRef,
          scrollVersion: "session-1:2",
          shouldVirtualize: true,
          virtualRowsCount: 4,
          virtualizer,
        }),
      );
      await flush();
    });

    const firstAnimationFrame = rafCallbacks.shift();
    if (!firstAnimationFrame) {
      throw new Error("Missing smooth-scroll animation frame");
    }
    firstAnimationFrame(0);
    const secondAnimationFrame = rafCallbacks.shift();
    if (!secondAnimationFrame) {
      throw new Error("Missing follow-up smooth-scroll animation frame");
    }
    secondAnimationFrame(1000);

    expect(measure).toHaveBeenCalledTimes(1);
    expect(scrollToIndex).toHaveBeenCalledTimes(0);
    const numericScrollCalls = scrollToMock.mock.calls
      .map((call) => Number(call[0]))
      .filter((value) => Number.isFinite(value));
    expect(numericScrollCalls.length).toBeGreaterThan(0);
    expect(numericScrollCalls[0]).toBeGreaterThan(480);
    expect(numericScrollCalls[0]).toBeLessThanOrEqual(640);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("does not auto-scroll on same-session updates while unpinned", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    setGlobalWindow({
      cancelAnimationFrame: mock((_id: number) => {}),
      requestAnimationFrame: mock((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      }),
    });

    const { measure, scrollToIndex, virtualizer } = createVirtualizerMock();
    const { container, scrollToMock } = createContainerMock();
    const messagesContainerRef = createRef<HTMLDivElement>();
    messagesContainerRef.current = container;

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: true,
          isPinnedToBottom: false,
          messagesContainerRef,
          scrollVersion: "session-1:1",
          shouldVirtualize: true,
          virtualRowsCount: 3,
          virtualizer,
        }),
      );
      await flush();
    });

    expect(measure).toHaveBeenCalledTimes(1);
    await act(async () => {
      drainAnimationFrames(rafCallbacks);
      await flush();
    });
    expect(scrollToIndex).toHaveBeenCalledTimes(0);
    expect(scrollToMock.mock.calls.length).toBeGreaterThanOrEqual(1);

    measure.mockClear();
    scrollToIndex.mockClear();
    scrollToMock.mockClear();
    rafCallbacks.length = 0;

    await act(async () => {
      renderer?.update(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: true,
          isPinnedToBottom: false,
          messagesContainerRef,
          scrollVersion: "session-1:2",
          shouldVirtualize: true,
          virtualRowsCount: 4,
          virtualizer,
        }),
      );
      await flush();
    });

    expect(rafCallbacks).toHaveLength(0);
    expect(measure).toHaveBeenCalledTimes(0);
    expect(scrollToIndex).toHaveBeenCalledTimes(0);
    expect(scrollToMock).toHaveBeenCalledTimes(0);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("jumps to the latest message when switching sessions even if the previous session was unpinned", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const cancelAnimationFrame = mock((_id: number) => {});
    setGlobalWindow({
      cancelAnimationFrame,
      requestAnimationFrame: mock((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      }),
    });

    const { measure, scrollToIndex, virtualizer } = createVirtualizerMock();
    const { container, scrollToMock } = createContainerMock();
    const messagesContainerRef = createRef<HTMLDivElement>();
    messagesContainerRef.current = container;

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: true,
          isPinnedToBottom: false,
          messagesContainerRef,
          scrollVersion: "session-1:1",
          shouldVirtualize: true,
          virtualRowsCount: 4,
          virtualizer,
        }),
      );
      await flush();
    });

    drainAnimationFrames(rafCallbacks);
    measure.mockClear();
    scrollToIndex.mockClear();
    scrollToMock.mockClear();

    await act(async () => {
      renderer?.update(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-2",
          canScrollToLatest: true,
          isPinnedToBottom: false,
          messagesContainerRef,
          scrollVersion: "session-2:1",
          shouldVirtualize: true,
          virtualRowsCount: 4,
          virtualizer,
        }),
      );
      await flush();
    });

    await act(async () => {
      drainAnimationFrames(rafCallbacks);
      await flush();
    });
    expect(measure.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(scrollToIndex).toHaveBeenCalledTimes(0);
    expect(scrollToMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(container.scrollTop).toBe(640);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("jumps to the latest message when the first selected session rows appear after mount", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const cancelAnimationFrame = mock((_id: number) => {});
    setGlobalWindow({
      cancelAnimationFrame,
      requestAnimationFrame: mock((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      }),
    });

    const { measure, scrollToIndex, virtualizer } = createVirtualizerMock();
    const { container, scrollToMock } = createContainerMock();
    const messagesContainerRef = createRef<HTMLDivElement>();
    messagesContainerRef.current = container;

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: false,
          isPinnedToBottom: false,
          messagesContainerRef,
          scrollVersion: "session-1:1",
          shouldVirtualize: true,
          virtualRowsCount: 0,
          virtualizer,
        }),
      );
      await flush();
    });

    expect(measure).toHaveBeenCalledTimes(0);
    expect(scrollToIndex).toHaveBeenCalledTimes(0);
    expect(scrollToMock).toHaveBeenCalledTimes(0);

    await act(async () => {
      renderer?.update(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: true,
          isPinnedToBottom: false,
          messagesContainerRef,
          scrollVersion: "session-1:1",
          shouldVirtualize: true,
          virtualRowsCount: 4,
          virtualizer,
        }),
      );
      await flush();
    });

    expect(measure).toHaveBeenCalledTimes(1);
    await act(async () => {
      drainAnimationFrames(rafCallbacks);
      await flush();
    });
    expect(scrollToIndex).toHaveBeenCalledTimes(0);
    expect(scrollToMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(container.scrollTop).toBe(640);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("keeps correcting a session-open jump while the bottom continues to grow", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    setGlobalWindow({
      cancelAnimationFrame: mock((_id: number) => {}),
      requestAnimationFrame: mock((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      }),
    });

    const { measure, scrollToIndex, virtualizer } = createVirtualizerMock();
    const { container, scrollToMock } = createContainerMock();
    const mutableContainer = container as HTMLDivElement & {
      scrollHeight: number;
      scrollTop: number;
    };
    mutableContainer.scrollHeight = 900;
    mutableContainer.scrollTop = 0;
    const messagesContainerRef = createRef<HTMLDivElement>();
    messagesContainerRef.current = container;

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          canScrollToLatest: true,
          isPinnedToBottom: false,
          messagesContainerRef,
          scrollVersion: "session-1:1",
          shouldVirtualize: true,
          virtualRowsCount: 6,
          virtualizer,
        }),
      );
      await flush();
    });

    const firstFrame = rafCallbacks.shift();
    if (!firstFrame) {
      throw new Error("Missing first session jump frame");
    }
    await act(async () => {
      firstFrame(0);
      await flush();
    });

    mutableContainer.scrollHeight = 1200;

    await act(async () => {
      drainAnimationFrames(rafCallbacks, { startTimestampMs: 16, stepMs: 16 });
      await flush();
    });

    expect(measure.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(scrollToIndex).toHaveBeenCalledTimes(0);
    expect(scrollToMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mutableContainer.scrollTop).toBe(880);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });
});
