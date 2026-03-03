import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement, createRef } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useAgentChatAutoScroll } from "./use-agent-chat-auto-scroll";
import type { AgentChatVirtualizer } from "./use-agent-chat-virtualization";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type AutoScrollHarnessProps = {
  activeSessionId: string | null;
  isPinnedToBottom: boolean;
  messagesContainerRef: ReturnType<typeof createRef<HTMLDivElement>>;
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
  const scrollToIndex = mock((_index: number, _options: { align: "end" }) => {});
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
  const scrollTo = mock((_options: ScrollToOptions) => {});
  return {
    container: {
      scrollHeight: 960,
      scrollTo,
    } as unknown as HTMLDivElement,
    scrollTo,
  };
};

const AutoScrollHarness = ({
  activeSessionId,
  isPinnedToBottom,
  messagesContainerRef,
  shouldVirtualize,
  virtualRowsCount,
  virtualizer,
}: AutoScrollHarnessProps): null => {
  useAgentChatAutoScroll({
    activeSessionId,
    isPinnedToBottom,
    messagesContainerRef,
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

  test("scrolls and measures when session changes", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = mock((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return 17;
    });
    const cancelAnimationFrame = mock((_id: number) => {});
    setGlobalWindow({
      cancelAnimationFrame,
      requestAnimationFrame,
    });

    const { measure, scrollToIndex, virtualizer } = createVirtualizerMock();
    const { container, scrollTo } = createContainerMock();
    const messagesContainerRef = createRef<HTMLDivElement>();
    messagesContainerRef.current = container;

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          isPinnedToBottom: true,
          messagesContainerRef,
          shouldVirtualize: true,
          virtualRowsCount: 4,
          virtualizer,
        }),
      );
      await flush();
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.length).toBe(1);
    expect(measure).toHaveBeenCalledTimes(0);
    expect(scrollToIndex).toHaveBeenCalledTimes(0);

    const rafCallback = rafCallbacks[0];
    if (!rafCallback) {
      throw new Error("Missing requestAnimationFrame callback");
    }
    rafCallback(0);

    expect(measure).toHaveBeenCalledTimes(1);
    expect(scrollToIndex).toHaveBeenCalledWith(3, { align: "end" });
    expect(scrollTo).toHaveBeenCalledWith({ top: 960, behavior: "auto" });

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
  });

  test("does not auto-scroll when staying on same session while unpinned", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = mock((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    const cancelAnimationFrame = mock((_id: number) => {});
    setGlobalWindow({
      cancelAnimationFrame,
      requestAnimationFrame,
    });

    const { measure, scrollToIndex, virtualizer } = createVirtualizerMock();
    const { container, scrollTo } = createContainerMock();
    const messagesContainerRef = createRef<HTMLDivElement>();
    messagesContainerRef.current = container;

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          isPinnedToBottom: true,
          messagesContainerRef,
          shouldVirtualize: true,
          virtualRowsCount: 3,
          virtualizer,
        }),
      );
      await flush();
    });

    const initialCallback = rafCallbacks[0];
    if (!initialCallback) {
      throw new Error("Missing initial requestAnimationFrame callback");
    }
    initialCallback(0);
    measure.mockClear();
    scrollToIndex.mockClear();
    scrollTo.mockClear();

    await act(async () => {
      renderer?.update(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          isPinnedToBottom: false,
          messagesContainerRef,
          shouldVirtualize: true,
          virtualRowsCount: 4,
          virtualizer,
        }),
      );
      await flush();
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledTimes(0);
    expect(scrollToIndex).toHaveBeenCalledTimes(0);
    expect(scrollTo).toHaveBeenCalledTimes(0);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("scrolls without measuring when pinned on same session", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    setGlobalWindow({
      cancelAnimationFrame: mock((_id: number) => {}),
      requestAnimationFrame: mock((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      }),
    });

    const { measure, scrollToIndex, virtualizer } = createVirtualizerMock();
    const { container, scrollTo } = createContainerMock();
    const messagesContainerRef = createRef<HTMLDivElement>();
    messagesContainerRef.current = container;

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          isPinnedToBottom: true,
          messagesContainerRef,
          shouldVirtualize: true,
          virtualRowsCount: 2,
          virtualizer,
        }),
      );
      await flush();
    });

    const initialCallback = rafCallbacks[0];
    if (!initialCallback) {
      throw new Error("Missing initial requestAnimationFrame callback");
    }
    initialCallback(0);
    measure.mockClear();
    scrollToIndex.mockClear();
    scrollTo.mockClear();

    await act(async () => {
      renderer?.update(
        createElement(AutoScrollHarness, {
          activeSessionId: "session-1",
          isPinnedToBottom: true,
          messagesContainerRef,
          shouldVirtualize: true,
          virtualRowsCount: 5,
          virtualizer,
        }),
      );
      await flush();
    });

    const followupCallback = rafCallbacks[1];
    if (!followupCallback) {
      throw new Error("Missing follow-up requestAnimationFrame callback");
    }
    followupCallback(0);

    expect(measure).toHaveBeenCalledTimes(0);
    expect(scrollToIndex).toHaveBeenCalledWith(4, { align: "end" });
    expect(scrollTo).toHaveBeenCalledWith({ top: 960, behavior: "auto" });

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });
});
