import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import { MarkdownPreviewModal } from "./markdown-preview-modal";

enableReactActEnvironment();

const writeClipboardMock = mock(async (_value: string) => {});
let restoreClipboard: (() => void) | null = null;

describe("MarkdownPreviewModal", () => {
  beforeEach(() => {
    writeClipboardMock.mockClear();
    writeClipboardMock.mockImplementation(async () => {});
    restoreClipboard = replaceNavigatorClipboard(writeClipboardMock);
  });

  afterEach(() => {
    restoreClipboard?.();
    restoreClipboard = null;
  });

  test("does not render dialog content when closed", () => {
    render(
      <MarkdownPreviewModal
        open={false}
        onOpenChange={() => {}}
        markdown="# Hello"
        title="Specification"
      />,
    );

    expect(screen.queryByText((c) => c.includes("Hello"))).toBeNull();
    expect(screen.queryByText("Specification")).toBeNull();
  });

  test("renders markdown content when open", () => {
    render(<MarkdownPreviewModal open onOpenChange={() => {}} markdown="# Hello World" />);

    expect(screen.getByText((c) => c.includes("Hello World"))).toBeDefined();
  });

  test("renders title when provided", () => {
    render(
      <MarkdownPreviewModal
        open
        onOpenChange={() => {}}
        markdown="# Content"
        title="Specification"
      />,
    );

    expect(screen.getByText("Specification")).toBeDefined();
  });

  test("renders sr-only default title when no title prop is provided", () => {
    render(<MarkdownPreviewModal open onOpenChange={() => {}} markdown="# Content" />);

    const title = screen.getByText("Document Preview");
    expect(title).toBeDefined();
    expect(title.className).toContain("sr-only");
  });

  test("renders copy button with expected test id", () => {
    render(<MarkdownPreviewModal open onOpenChange={() => {}} markdown="# Content" />);

    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();
  });

  test("copies raw markdown to clipboard on copy button click", async () => {
    await withMockedToast(async () => {
      render(<MarkdownPreviewModal open onOpenChange={() => {}} markdown="# Raw Markdown" />);

      const copyButton = screen.getByTestId("markdown-preview-modal-copy");
      fireEvent.click(copyButton);

      expect(writeClipboardMock).toHaveBeenCalledWith("# Raw Markdown");
    });
  });
});
