import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { buildCopyPreview } from "@/lib/copy-preview";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import { TaskDetailsMarkdownContent } from "./task-details-markdown-content";

enableReactActEnvironment();

const writeClipboardMock = mock(async (_value: string) => {});
let restoreClipboard: (() => void) | null = null;

describe("TaskDetailsMarkdownContent", () => {
  beforeEach(() => {
    writeClipboardMock.mockClear();
    writeClipboardMock.mockImplementation(async () => {});
    restoreClipboard = replaceNavigatorClipboard(writeClipboardMock);
  });

  afterEach(() => {
    restoreClipboard?.();
    restoreClipboard = null;
  });

  test("renders floating copy button when copyable markdown is provided", () => {
    const rendered = render(
      createElement(TaskDetailsMarkdownContent, {
        markdown: "# Spec\n\nDetails",
        empty: "No spec",
        active: true,
        copyableMarkdown: "# Spec\n\nDetails",
      }),
    );

    const button = rendered.getByTestId("copy-document-content");
    expect(button.className).toContain("absolute");
    expect(button.className).toContain("top-2");
    expect(button.className).toContain("right-2");
    rendered.unmount();
  });

  test("does not render copy button when copyable markdown is missing", () => {
    const rendered = render(
      createElement(TaskDetailsMarkdownContent, {
        markdown: "# Plan\n\nText",
        empty: "No plan",
        active: true,
      }),
    );

    expect(rendered.queryByTestId("copy-document-content")).toBeNull();
    rendered.unmount();
  });

  test("copies markdown and shows success toast", async () => {
    await withMockedToast(async ({ toastSuccessMock }) => {
      const markdown = "12345678901234567890123456789012345678901234567890tail";
      const rendered = render(
        createElement(TaskDetailsMarkdownContent, {
          markdown,
          empty: "No doc",
          active: true,
          copyableMarkdown: markdown,
        }),
      );

      try {
        fireEvent.click(rendered.getByTestId("copy-document-content"));

        await waitFor(() => {
          expect(writeClipboardMock).toHaveBeenCalledWith(markdown);
          expect(toastSuccessMock).toHaveBeenCalledWith("Copied!", {
            description: buildCopyPreview(markdown),
          });
        });
      } finally {
        rendered.unmount();
      }
    });
  });

  test("uses full markdown as success preview when text is short", async () => {
    await withMockedToast(async ({ toastSuccessMock }) => {
      const markdown = "short text";
      const rendered = render(
        createElement(TaskDetailsMarkdownContent, {
          markdown,
          empty: "No doc",
          active: true,
          copyableMarkdown: markdown,
        }),
      );

      try {
        fireEvent.click(rendered.getByTestId("copy-document-content"));

        await waitFor(() => {
          expect(toastSuccessMock).toHaveBeenCalledWith("Copied!", {
            description: buildCopyPreview(markdown),
          });
        });
      } finally {
        rendered.unmount();
      }
    });
  });

  test("shows error toast when clipboard copy fails", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const error = new DOMException("blocked by browser", "NotAllowedError");
      writeClipboardMock.mockImplementation(async () => {
        throw error;
      });

      const rendered = render(
        createElement(TaskDetailsMarkdownContent, {
          markdown: "# QA\n\nfailed",
          empty: "No QA",
          active: true,
          copyableMarkdown: "# QA\n\nfailed",
        }),
      );

      try {
        fireEvent.click(rendered.getByTestId("copy-document-content"));

        await waitFor(() => {
          expect(toastErrorMock).toHaveBeenCalledWith(
            "Permission denied: clipboard access not allowed",
          );
        });
      } finally {
        rendered.unmount();
      }
    });
  });

  test("shows check icon after successful copy", async () => {
    await withMockedToast(async () => {
      const rendered = render(
        createElement(TaskDetailsMarkdownContent, {
          markdown: "# Spec",
          empty: "No doc",
          active: true,
          copyableMarkdown: "# Spec",
        }),
      );

      try {
        const button = rendered.getByTestId("copy-document-content");
        expect(button.querySelector(".lucide-copy")).not.toBeNull();

        fireEvent.click(button);

        await waitFor(() => {
          expect(button.querySelector(".lucide-check")).not.toBeNull();
        });
      } finally {
        rendered.unmount();
      }
    });
  });
});
