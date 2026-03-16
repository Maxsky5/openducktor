import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, Fragment } from "react";
import TestRenderer, { act } from "react-test-renderer";
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

type RowElementProps = {
  "data-row-key"?: unknown;
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

const createAnimatedElement = (): MockAnimatedElement => {
  const animation = createMockAnimation();
  return {
    animate: mock(() => animation),
    style: {
      willChange: "",
    },
  } as unknown as MockAnimatedElement;
};

describe("useAgentChatRowMotion", () => {
  const originalMatchMedia = globalThis.matchMedia;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
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
  });

  afterEach(() => {
    if (typeof originalWindow === "undefined") {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    globalThis.matchMedia = originalMatchMedia;
  });

  test("animates newly appended rows with fade-only timing", async () => {
    const elementByKey = new Map([
      ["row-a", createAnimatedElement()],
      ["row-b", createAnimatedElement()],
    ]);

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

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Harness, {
          activeSessionId: "session-1",
          rowKeys: ["row-a"],
          windowStart: 20,
        }),
        {
          createNodeMock: (element) => {
            const props = (element.props ?? {}) as RowElementProps;
            const rowKey = props["data-row-key"];
            return typeof rowKey === "string"
              ? (elementByKey.get(rowKey) ?? createAnimatedElement())
              : createAnimatedElement();
          },
        },
      );
      await flush();
    });

    const appendedRowElement = elementByKey.get("row-b");
    if (!appendedRowElement) {
      throw new Error("Expected appended row element");
    }

    await act(async () => {
      renderer.update(
        createElement(Harness, {
          activeSessionId: "session-1",
          rowKeys: ["row-a", "row-b"],
          windowStart: 20,
        }),
      );
      await flush();
    });

    expect(appendedRowElement.animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
      duration: 1000,
      easing: "linear",
      fill: "both",
    });

    await act(async () => {
      renderer.unmount();
      await flush();
    });
  });

  test("does not animate newly seen rows when history is prepended", async () => {
    const prependedRowElement = createAnimatedElement();
    const elementByKey = new Map([
      ["row-a", prependedRowElement],
      ["row-b", createAnimatedElement()],
      ["row-c", createAnimatedElement()],
    ]);

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

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Harness, {
          activeSessionId: "session-1",
          rowKeys: ["row-b", "row-c"],
          windowStart: 20,
        }),
        {
          createNodeMock: (element) => {
            const props = (element.props ?? {}) as RowElementProps;
            const rowKey = props["data-row-key"];
            return typeof rowKey === "string"
              ? (elementByKey.get(rowKey) ?? createAnimatedElement())
              : createAnimatedElement();
          },
        },
      );
      await flush();
    });

    await act(async () => {
      renderer.update(
        createElement(Harness, {
          activeSessionId: "session-1",
          rowKeys: ["row-a", "row-b", "row-c"],
          windowStart: 0,
        }),
      );
      await flush();
    });

    expect(prependedRowElement.animate).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
      await flush();
    });
  });
});
