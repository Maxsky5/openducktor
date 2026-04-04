import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";

enableReactActEnvironment();

const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});
const writeClipboardMock = mock(async (_value: string) => {});

type TaskDetailsMarkdownContentComponent =
  typeof import("./task-details-markdown-content").TaskDetailsMarkdownContent;
let TaskDetailsMarkdownContent: TaskDetailsMarkdownContentComponent;

describe("TaskDetailsMarkdownContent", () => {
  beforeAll(async () => {
    mock.module("sonner", () => ({
      toast: {
        success: toastSuccessMock,
        error: toastErrorMock,
        loading: () => "",
        dismiss: () => {},
      },
    }));

    ({ TaskDetailsMarkdownContent } = await import("./task-details-markdown-content"));
  });

  beforeEach(() => {
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
    writeClipboardMock.mockClear();
    writeClipboardMock.mockImplementation(async () => {});

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeClipboardMock,
      },
    });
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
    const markdown = "12345678901234567890123456789012345678901234567890tail";
    const rendered = render(
      createElement(TaskDetailsMarkdownContent, {
        markdown,
        empty: "No doc",
        active: true,
        copyableMarkdown: markdown,
      }),
    );

    fireEvent.click(rendered.getByTestId("copy-document-content"));

    await waitFor(() => {
      expect(writeClipboardMock).toHaveBeenCalledWith(markdown);
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied!", {
        description: `${markdown.slice(0, 50)}...`,
      });
    });
    rendered.unmount();
  });

  test("uses full markdown as success preview when text is short", async () => {
    const markdown = "short text";
    const rendered = render(
      createElement(TaskDetailsMarkdownContent, {
        markdown,
        empty: "No doc",
        active: true,
        copyableMarkdown: markdown,
      }),
    );

    fireEvent.click(rendered.getByTestId("copy-document-content"));

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied!", {
        description: markdown,
      });
    });
    rendered.unmount();
  });

  test("shows error toast when clipboard copy fails", async () => {
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

    fireEvent.click(rendered.getByTestId("copy-document-content"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Permission denied: clipboard access not allowed",
      );
    });
    rendered.unmount();
  });

  test("shows check icon for two seconds after successful copy", async () => {
    const rendered = render(
      createElement(TaskDetailsMarkdownContent, {
        markdown: "# Spec",
        empty: "No doc",
        active: true,
        copyableMarkdown: "# Spec",
        copyResetDelayMs: 5,
      }),
    );

    try {
      const button = rendered.getByTestId("copy-document-content");
      expect(button.querySelector(".lucide-copy")).not.toBeNull();

      fireEvent.click(button);

      await waitFor(() => {
        expect(button.querySelector(".lucide-check")).not.toBeNull();
      });

      await waitFor(
        () => {
          expect(button.querySelector(".lucide-copy")).not.toBeNull();
        },
        { timeout: 200 },
      );
    } finally {
      rendered.unmount();
    }
  });
});
