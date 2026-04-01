import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, createRef } from "react";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { CHAT_SHIFT_SIZE } from "./agent-chat-thread-windowing";
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

type TriggerableIntersectionObserver = IntersectionObserver & {
  trigger: (entries?: Partial<IntersectionObserverEntry>[]) => void;
};

const ROW_HEIGHT_PX = 40;
const animationFrameCallbacks = new Map<number, FrameRequestCallback>();
const mockIntersectionObservers: TriggerableIntersectionObserver[] = [];
let nextAnimationFrameId = 1;

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
    const fallbackTarget = document.createElement("div");
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

const createRows = (count: number): AgentChatWindowRow[] =>
  Array.from({ length: count }, (_, index) => ({
    kind: "message" as const,
    key: `session-1:msg-${index}`,
    message: {
      id: `msg-${index}`,
      role: "assistant" as const,
      content: `Message ${index}`,
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

const createTurnRows = (turnCount: number): AgentChatWindowRow[] =>
  Array.from({ length: turnCount }, (_, turnIndex) => [
    {
      kind: "message" as const,
      key: `session-1:user-${turnIndex}`,
      message: {
        id: `user-${turnIndex}`,
        role: "user" as const,
        content: `Question ${turnIndex}`,
        timestamp: "2026-02-20T10:01:00.000Z",
      },
    },
    {
      kind: "message" as const,
      key: `session-1:assistant-${turnIndex}`,
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

const createHarness = () => {
  const messagesContainerRef = createRef<HTMLDivElement>();
  const messagesContentRef = createRef<HTMLDivElement>();
  const latestResultRef: { current: HookResult | null } = { current: null };

  return {
    messagesContainerRef,
    messagesContentRef,
    latestResultRef,
    hook: (props: HarnessProps) => {
      const result = useAgentChatWindow({
        ...props,
        isSessionWorking: props.isSessionWorking ?? false,
        messagesContainerRef,
        messagesContentRef,
        ...(props.syncBottomAfterComposerLayoutRef
          ? { syncBottomAfterComposerLayoutRef: props.syncBottomAfterComposerLayoutRef }
          : {}),
      });
      latestResultRef.current = result;
      return result;
    },
  };
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
  },
): Promise<{
  getLatestResult: () => HookResult;
  messagesContainerRef: ReturnType<typeof createHarness>["messagesContainerRef"];
  messagesContentRef: ReturnType<typeof createHarness>["messagesContentRef"];
  update: (nextProps: HarnessProps) => Promise<void>;
  unmount: () => Promise<void>;
}> => {
  const { hook, latestResultRef, messagesContainerRef, messagesContentRef } = createHarness();

  if (options?.attachDom) {
    const container = document.createElement("div") as HTMLDivElement & {
      scrollTo: ReturnType<typeof mock<(options: ScrollToOptions) => void>>;
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    };
    const content = document.createElement("div") as HTMLDivElement & {
      scrollHeight: number;
    };
    let scrollTopValue = 0;

    Object.defineProperty(container, "scrollTo", {
      configurable: true,
      value: mock((options: ScrollToOptions) => {
        if (typeof options.top === "number") {
          container.scrollTop = options.top;
        }
      }),
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      get: () => 300,
    });
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      get: () => getLatestResult(latestResultRef).windowedRows.length * ROW_HEIGHT_PX,
    });
    Object.defineProperty(content, "scrollHeight", {
      configurable: true,
      get: () => getLatestResult(latestResultRef).windowedRows.length * ROW_HEIGHT_PX,
    });
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        scrollTopValue = Math.max(0, Math.min(value, maxScrollTop));
      },
    });
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 0 }) as DOMRect,
    });
    Object.defineProperty(container, "querySelectorAll", {
      configurable: true,
      value: () => {
        return getLatestResult(latestResultRef).windowedRows.map((row, index) => {
          return {
            dataset: { rowKey: row.key },
            getBoundingClientRect: () => ({ top: index * ROW_HEIGHT_PX }) as DOMRect,
          } as unknown as HTMLElement;
        }) as unknown as NodeListOf<Element>;
      },
    });

    messagesContainerRef.current = container;
    messagesContentRef.current = content;
  }

  const harness = createSharedHookHarness(hook, props);
  await harness.mount();

  return {
    getLatestResult: () => getLatestResult(latestResultRef),
    messagesContainerRef,
    messagesContentRef,
    update: (nextProps: HarnessProps) => harness.update(nextProps),
    unmount: () => harness.unmount(),
  };
};

describe("useAgentChatWindow", () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    mockIntersectionObservers.length = 0;
    animationFrameCallbacks.clear();
    nextAnimationFrameId = 1;
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
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
    globalThis.IntersectionObserver = originalIntersectionObserver;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test("starts with the latest turn window", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness({
      rows,
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(4);
    expect(result.windowEnd).toBe(rows.length - 1);
    expect(result.windowedRows).toEqual(rows.slice(4));

    await harness.unmount();
  });

  test("keeps the same rendered row slice reference when inputs are unchanged", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness({
      rows,
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });
    const initialWindowedRows = harness.getLatestResult().windowedRows;

    await harness.update({
      rows,
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    expect(harness.getLatestResult().windowedRows).toBe(initialWindowedRows);

    await harness.unmount();
  });

  test("starts with a bottom-anchored viewport slice for long transcripts", async () => {
    const rows = createRows(80);
    const harness = await mountHarness({
      rows,
      activeSessionId: "session-1",
      isSessionViewLoading: false,
    });

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(20);
    expect(result.windowEnd).toBe(79);
    expect(result.windowedRows).toEqual(rows.slice(20));

    await harness.unmount();
  });

  test("scrollToTop reveals the full transcript and moves to top", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );
    await flushAnimationFrames();

    await act(async () => {
      harness.getLatestResult().scrollToTop();
      await flush();
    });
    await flushAnimationFrames();

    const result = harness.getLatestResult();
    expect(result.windowStart).toBe(0);
    expect(result.windowEnd).toBe(rows.length - 1);
    expect(result.isNearTop).toBe(true);
    expect((harness.messagesContainerRef.current as HTMLDivElement | null)?.scrollTop).toBe(0);

    await harness.unmount();
  });

  test("scrollToBottom collapses back to the latest turns and jumps to bottom", async () => {
    const rows = createTurnRows(12);
    const harness = await mountHarness(
      {
        rows,
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );
    await flushAnimationFrames();

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

    const result = harness.getLatestResult();
    const container = harness.messagesContainerRef.current as HTMLDivElement | null;
    expect(result.windowStart).toBe(4);
    expect(result.windowEnd).toBe(rows.length - 1);
    expect(container?.scrollTop).toBe(
      Math.max(0, (container?.scrollHeight ?? 0) - (container?.clientHeight ?? 0)),
    );

    await harness.unmount();
  });

  test("shifts the viewport slice upward when the top sentinel is reached", async () => {
    const rows = createRows(120);
    const harness = await mountHarness(
      {
        rows,
        activeSessionId: "session-1",
        isSessionViewLoading: false,
      },
      { attachDom: true },
    );
    await flushAnimationFrames();
    const container = harness.messagesContainerRef.current as HTMLDivElement | null;
    if (!container) {
      throw new Error("Expected messages container");
    }

    container.scrollTop = 160;

    await act(async () => {
      harness.getLatestResult().topSentinelRef(document.createElement("div"));
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
    await flushAnimationFrames();

    expect(harness.getLatestResult().windowStart).toBe(40);
    expect(container.scrollTop).toBe(160 + CHAT_SHIFT_SIZE * ROW_HEIGHT_PX);

    await harness.unmount();
  });
});
