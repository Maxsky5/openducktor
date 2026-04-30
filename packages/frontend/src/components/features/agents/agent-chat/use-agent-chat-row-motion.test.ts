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
  activeExternalSessionId: string | null;
  rowKeys: string[];
  windowStart: number;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("useAgentChatRowMotion", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalAnimate = HTMLElement.prototype.animate;

  const Harness = ({ activeExternalSessionId, rowKeys, windowStart }: HarnessProps) => {
    const { registerRowElement } = useAgentChatRowMotion({
      activeExternalSessionId,
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
    (globalThis as { window?: unknown }).window = globalThis;
    HTMLElement.prototype.animate = mock(() => {
      throw new Error("animate should not be called");
    });
  });

  afterEach(() => {
    if (typeof originalWindow === "undefined") {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    HTMLElement.prototype.animate = originalAnimate;
  });

  test("does not animate newly appended rows", async () => {
    const rendered = render(
      createElement(Harness, {
        activeExternalSessionId: "session-1",
        rowKeys: ["row-a"],
        windowStart: 20,
      }),
    );
    await act(flush);

    await act(async () => {
      rendered.rerender(
        createElement(Harness, {
          activeExternalSessionId: "session-1",
          rowKeys: ["row-a", "row-b"],
          windowStart: 20,
        }),
      );
      await flush();
    });

    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();

    await act(async () => {
      rendered.unmount();
      await flush();
    });
  });

  test("does not animate newly seen rows when history is prepended", async () => {
    const rendered = render(
      createElement(Harness, {
        activeExternalSessionId: "session-1",
        rowKeys: ["row-b", "row-c"],
        windowStart: 20,
      }),
    );
    await act(flush);

    await act(async () => {
      rendered.rerender(
        createElement(Harness, {
          activeExternalSessionId: "session-1",
          rowKeys: ["row-a", "row-b", "row-c"],
          windowStart: 0,
        }),
      );
      await flush();
    });

    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();

    await act(async () => {
      rendered.unmount();
      await flush();
    });
  });

  test("does not animate the first populated render after a deferred empty session frame", async () => {
    const rendered = render(
      createElement(Harness, {
        activeExternalSessionId: "session-2",
        rowKeys: [],
        windowStart: 0,
      }),
    );
    await act(flush);

    await act(async () => {
      rendered.rerender(
        createElement(Harness, {
          activeExternalSessionId: "session-2",
          rowKeys: ["row-a", "row-b"],
          windowStart: 20,
        }),
      );
      await flush();
    });

    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();

    await act(async () => {
      rendered.unmount();
      await flush();
    });
  });
});
