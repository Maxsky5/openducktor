import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { withMockedToast } from "@/test-utils/mock-toast";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

enableReactActEnvironment();

const writeClipboardMock = mock(async (_value: string) => {});

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

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeClipboardMock,
      },
    });
  });

  test("resets copied state after the configured delay", async () => {
    await withMockedToast(async () => {
      const rendered = render(createElement(ClipboardHookHarness, { resetDelayMs: 5 }));

      try {
        const button = rendered.getByTestId("copy-harness");
        expect(button.getAttribute("data-copied")).toBe("false");

        fireEvent.click(button);

        await waitFor(() => {
          expect(button.getAttribute("data-copied")).toBe("true");
        });

        await waitFor(() => {
          expect(button.getAttribute("data-copied")).toBe("false");
        });
      } finally {
        rendered.unmount();
      }
    });
  });
});
