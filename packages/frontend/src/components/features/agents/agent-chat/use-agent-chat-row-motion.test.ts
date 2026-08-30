import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { act, createElement, Fragment } from "react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { useAgentChatRowMotion } from "./use-agent-chat-row-motion";

enableReactActEnvironment();

type HarnessProps = {
  rowKeys: string[];
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("useAgentChatRowMotion", () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalAnimate = HTMLElement.prototype.animate;

  const Harness = ({ rowKeys }: HarnessProps) => {
    const { registerRowElement } = useAgentChatRowMotion();

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
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
      writable: true,
    });
    HTMLElement.prototype.animate = mock(() => {
      throw new Error("animate should not be called");
    });
  });

  afterEach(() => {
    if (originalWindowDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    }
    HTMLElement.prototype.animate = originalAnimate;
  });

  test("does not animate newly appended rows", async () => {
    const rendered = render(
      createElement(Harness, {
        rowKeys: ["row-a"],
      }),
    );
    await act(flush);

    await act(async () => {
      rendered.rerender(
        createElement(Harness, {
          rowKeys: ["row-a", "row-b"],
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
        rowKeys: ["row-b", "row-c"],
      }),
    );
    await act(flush);

    await act(async () => {
      rendered.rerender(
        createElement(Harness, {
          rowKeys: ["row-a", "row-b", "row-c"],
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

  test("does not animate the first populated render after an empty session frame", async () => {
    const rendered = render(
      createElement(Harness, {
        rowKeys: [],
      }),
    );
    await act(flush);

    await act(async () => {
      rendered.rerender(
        createElement(Harness, {
          rowKeys: ["row-a", "row-b"],
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
