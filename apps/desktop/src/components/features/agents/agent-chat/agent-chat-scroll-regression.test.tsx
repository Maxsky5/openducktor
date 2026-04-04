import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { act, type ReactElement, useRef, useState } from "react";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import {
  COMPOSER_EDITOR_MIN_HEIGHT_PX,
  COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
  useAgentChatLayout,
} from "./use-agent-chat-layout";
import { useAgentChatWindow } from "./use-agent-chat-window";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type MockResizeObserverController = {
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
  observedElements: Set<Element>;
};

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

const flushAnimationFrames = async (): Promise<void> => {
  while (animationFrameCallbacks.size > 0) {
    const queuedCallbacks = Array.from(animationFrameCallbacks.values());
    animationFrameCallbacks.clear();

    await act(async () => {
      for (const callback of queuedCallbacks) {
        callback(16);
      }
      await Promise.resolve();
    });
  }
};

function ChatScrollRegressionHarness(): ReactElement {
  const [input, setInput] = useState("");
  const syncBottomAfterComposerLayoutRef = useRef<(() => void) | null>(null);
  const { messagesContainerRef, composerTextareaRef, resizeComposerTextarea } = useAgentChatLayout({
    input,
    activeSessionId: "session-1",
    syncBottomAfterComposerLayoutRef,
  });
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const { isNearBottom } = useAgentChatWindow({
    rows: createRows(80),
    activeSessionId: "session-1",
    isSessionViewLoading: false,
    messagesContainerRef,
    messagesContentRef,
    syncBottomAfterComposerLayoutRef,
  });

  return (
    <div>
      <div ref={messagesContainerRef} data-testid="messages-container">
        <div ref={messagesContentRef} data-testid="messages-content" />
      </div>
      <textarea
        ref={composerTextareaRef}
        data-testid="composer"
        data-multiline={input.includes("\n") ? "true" : "false"}
        rows={1}
        value={input}
        onChange={(event) => setInput(event.currentTarget.value)}
        onInput={resizeComposerTextarea}
      />
      <button
        type="button"
        data-testid="grow-composer"
        onClick={() => setInput("line one\nline two")}
      >
        Grow composer
      </button>
      <output data-testid="is-near-bottom">{String(isNearBottom)}</output>
    </div>
  );
}

function ChatEditorScrollRegressionHarness(): ReactElement {
  const [input, setInput] = useState("");
  const syncBottomAfterComposerLayoutRef = useRef<(() => void) | null>(null);
  const { messagesContainerRef, composerEditorRef, resizeComposerEditor } = useAgentChatLayout({
    activeSessionId: "session-1",
    syncBottomAfterComposerLayoutRef,
  });
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const { isNearBottom } = useAgentChatWindow({
    rows: createRows(80),
    activeSessionId: "session-1",
    isSessionViewLoading: false,
    messagesContainerRef,
    messagesContentRef,
    syncBottomAfterComposerLayoutRef,
  });

  return (
    <div>
      <div ref={messagesContainerRef} data-testid="messages-container">
        <div ref={messagesContentRef} data-testid="messages-content" />
      </div>
      <div
        ref={composerEditorRef}
        contentEditable
        suppressContentEditableWarning
        data-testid="composer-editor"
        data-multiline={input.includes("\n") ? "true" : "false"}
        onInput={resizeComposerEditor}
      >
        {input}
      </div>
      <button
        type="button"
        data-testid="grow-composer-editor"
        onClick={() => setInput("line one\nline two")}
      >
        Grow composer editor
      </button>
      <output data-testid="is-near-bottom">{String(isNearBottom)}</output>
    </div>
  );
}

describe("agent chat scroll regression", () => {
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

  test("keeps the transcript pinned after returning to bottom and growing the composer", async () => {
    render(<ChatScrollRegressionHarness />);

    const container = screen.getByTestId("messages-container") as HTMLDivElement & {
      scrollTo: (options: ScrollToOptions) => void;
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    };
    const content = screen.getByTestId("messages-content") as HTMLDivElement & {
      scrollHeight: number;
    };
    const textarea = screen.getByTestId("composer") as HTMLTextAreaElement;
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      writable: true,
      value: 1000,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      writable: true,
      value: 300,
    });
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 700,
    });
    Object.defineProperty(content, "scrollHeight", {
      configurable: true,
      writable: true,
      value: 1000,
    });
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => (textarea.dataset.multiline === "true" ? 120 : COMPOSER_TEXTAREA_MIN_HEIGHT_PX),
    });

    await act(async () => {
      fireEvent.scroll(container);
    });

    container.scrollTop = 500;
    await act(async () => {
      fireEvent.scroll(container);
    });
    await flushAnimationFrames();
    expect(screen.getByTestId("is-near-bottom").textContent).toBe("false");

    container.scrollTop = 700;
    await act(async () => {
      fireEvent.scroll(container);
    });
    await flushAnimationFrames();
    expect(screen.getByTestId("is-near-bottom").textContent).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByTestId("grow-composer"));
    });
    await act(async () => {
      await Promise.resolve();
      fireEvent.input(textarea);
    });
    expect(textarea.dataset.multiline).toBe("true");

    container.clientHeight = 220;
    await flushAnimationFrames();
    await act(async () => {
      triggerResizeObservers();
    });
    await flushAnimationFrames();

    expect(container.scrollTop).toBe(1000);
    expect(screen.getByTestId("is-near-bottom").textContent).toBe("true");
  });

  test("keeps the transcript pinned after growing the contenteditable composer", async () => {
    render(<ChatEditorScrollRegressionHarness />);

    const container = screen.getByTestId("messages-container") as HTMLDivElement & {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    };
    const content = screen.getByTestId("messages-content") as HTMLDivElement & {
      scrollHeight: number;
    };
    const editor = screen.getByTestId("composer-editor") as HTMLDivElement & {
      scrollHeight: number;
      getBoundingClientRect: () => { height: number };
    };

    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      writable: true,
      value: 1000,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      writable: true,
      value: 300,
    });
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 700,
    });
    Object.defineProperty(content, "scrollHeight", {
      configurable: true,
      writable: true,
      value: 1000,
    });
    Object.defineProperty(editor, "scrollHeight", {
      configurable: true,
      get: () => (editor.dataset.multiline === "true" ? 120 : COMPOSER_EDITOR_MIN_HEIGHT_PX),
    });
    Object.defineProperty(editor, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        height: editor.dataset.multiline === "true" ? 120 : COMPOSER_EDITOR_MIN_HEIGHT_PX,
      }),
    });

    await act(async () => {
      fireEvent.scroll(container);
    });

    container.scrollTop = 500;
    await act(async () => {
      fireEvent.scroll(container);
    });
    await flushAnimationFrames();
    expect(screen.getByTestId("is-near-bottom").textContent).toBe("false");

    container.scrollTop = 700;
    await act(async () => {
      fireEvent.scroll(container);
    });
    await flushAnimationFrames();
    expect(screen.getByTestId("is-near-bottom").textContent).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByTestId("grow-composer-editor"));
    });
    await act(async () => {
      await Promise.resolve();
      fireEvent.input(editor);
    });
    expect(editor.dataset.multiline).toBe("true");

    container.clientHeight = 220;
    await flushAnimationFrames();
    await act(async () => {
      triggerResizeObservers();
    });
    await flushAnimationFrames();

    expect(container.scrollTop).toBe(1000);
    expect(screen.getByTestId("is-near-bottom").textContent).toBe("true");
  });
});
