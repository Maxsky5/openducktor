import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { act, createElement, Fragment } from "react";
import { useAgentChatRowMotion } from "./use-agent-chat-row-motion";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessProps = {
  activeSessionId: string | null;
  rowKeys: string[];
  windowStart: number;
};

type MockAnimation = Animation & {
  addEventListener: ReturnType<typeof mock>;
  cancel: ReturnType<typeof mock>;
};

type MockAnimatedElement = HTMLDivElement & {
  animate: ReturnType<typeof mock>;
  style: {
    willChange: string;
  };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createMockAnimation = (): MockAnimation => {
  return {
    addEventListener: mock(() => undefined),
    cancel: mock(() => undefined),
  } as unknown as MockAnimation;
};

describe("useAgentChatRowMotion", () => {
  const originalMatchMedia = globalThis.matchMedia;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalAnimate = HTMLElement.prototype.animate;
  let elementByKey: Map<string, MockAnimatedElement>;

  const Harness = ({ activeSessionId, rowKeys, windowStart }: HarnessProps) => {
    const { registerRowElement } = useAgentChatRowMotion({
      activeSessionId,
      rowKeys,
      windowStart,
    });

    return createElement(
      Fragment,
      null,
      ...rowKeys.map((rowKey) =>
        createElement("div", {
          key: rowKey,
          ref: registerRowElement(rowKey),
          "data-row-key": rowKey,
        }),
      ),
    );
  };

  beforeEach(() => {
    elementByKey = new Map();
    (globalThis as { window?: unknown }).window = globalThis;
    globalThis.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof matchMedia;

    HTMLElement.prototype.animate = function (...args) {
      const animation = createMockAnimation();
      const element = this as MockAnimatedElement;
      element.animate = mock(() => animation) as MockAnimatedElement["animate"];
      element.animate(...args);
      const rowKey = element.getAttribute("data-row-key");
      if (rowKey) {
        elementByKey.set(rowKey, element);
      }
      return animation;
    };
  });

  afterEach(() => {
    if (typeof originalWindow === "undefined") {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    globalThis.matchMedia = originalMatchMedia;
    HTMLElement.prototype.animate = originalAnimate;
  });

  test("animates newly appended rows with fade-only timing", async () => {
    const rendered = render(
      createElement(Harness, {
        activeSessionId: "session-1",
        rowKeys: ["row-a"],
        windowStart: 20,
      }),
    );
    await act(flush);

    await act(async () => {
      rendered.rerender(
        createElement(Harness, {
          activeSessionId: "session-1",
          rowKeys: ["row-a", "row-b"],
          windowStart: 20,
        }),
      );
      await flush();
    });

    const appendedRowElement = elementByKey.get("row-b");
    if (!appendedRowElement) {
      throw new Error("Expected appended row element");
    }

    expect(appendedRowElement.animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
      duration: 1000,
      easing: "linear",
      fill: "both",
    });

    await act(async () => {
      rendered.unmount();
      await flush();
    });
  });

  test("does not animate newly seen rows when history is prepended", async () => {
    const rendered = render(
      createElement(Harness, {
        activeSessionId: "session-1",
        rowKeys: ["row-b", "row-c"],
        windowStart: 20,
      }),
    );
    await act(flush);

    await act(async () => {
      rendered.rerender(
        createElement(Harness, {
          activeSessionId: "session-1",
          rowKeys: ["row-a", "row-b", "row-c"],
          windowStart: 0,
        }),
      );
      await flush();
    });

    const prependedRowElement = rendered.container.querySelector('[data-row-key="row-a"]');
    if (!prependedRowElement) {
      throw new Error("Expected prepended row element");
    }

    expect(elementByKey.has("row-a")).toBe(false);

    await act(async () => {
      rendered.unmount();
      await flush();
    });
  });
});
