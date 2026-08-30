import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { act, createElement, type ReactElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

enableReactActEnvironment();

const writeClipboardMock = mock(async (_value: string) => {});
let restoreClipboard: (() => void) | null = null;

function ClipboardHookHarness({ resetDelayMs }: { resetDelayMs: number }): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    resetDelayMs,
  });

  return (
    <button
      type="button"
      data-testid="copy-harness"
      data-copied={copied ? "true" : "false"}
      onClick={() => {
        void copyToClipboard("# Spec");
      }}
    >
      Copy
    </button>
  );
}

describe("useCopyToClipboard", () => {
  beforeEach(() => {
    writeClipboardMock.mockClear();
    writeClipboardMock.mockImplementation(async () => {});
    restoreClipboard = replaceNavigatorClipboard(writeClipboardMock);
  });

  afterEach(() => {
    restoreClipboard?.();
    restoreClipboard = null;
  });

  test("resets copied state after the configured delay", async () => {
    jest.useFakeTimers();
    try {
      await withMockedToast(async () => {
        const rendered = render(createElement(ClipboardHookHarness, { resetDelayMs: 5 }));

        try {
          const button = rendered.getByTestId("copy-harness");
          expect(button.getAttribute("data-copied")).toBe("false");

          await act(async () => {
            fireEvent.click(button);
            await Promise.resolve();
          });
          expect(button.getAttribute("data-copied")).toBe("true");

          act(() => {
            jest.advanceTimersByTime(5);
          });
          expect(button.getAttribute("data-copied")).toBe("false");
        } finally {
          rendered.unmount();
        }
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
