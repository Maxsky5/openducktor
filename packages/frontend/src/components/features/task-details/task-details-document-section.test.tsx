import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileText } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import { TaskDetailsDocumentSection } from "./task-details-document-section";

enableReactActEnvironment();

const ICON = createElement(FileText, { className: "size-3.5" });
const TITLE = "Description";
const EMPTY = "No description.";
const UPDATED_AT = "2026-01-01T00:00:00Z";

describe("TaskDetailsDocumentSection", () => {
  test("renders expand button when document has content", () => {
    const html = renderToStaticMarkup(
      createElement(TaskDetailsDocumentSection, {
        title: TITLE,
        icon: ICON,
        markdown: "# Content",
        updatedAt: UPDATED_AT,
        empty: EMPTY,
        defaultExpanded: true,
      }),
    );
    expect(html).toContain('data-testid="expand-description"');
  });

  test("does not render expand button when document is empty", () => {
    const html = renderToStaticMarkup(
      createElement(TaskDetailsDocumentSection, {
        title: TITLE,
        icon: ICON,
        markdown: "",
        updatedAt: UPDATED_AT,
        empty: EMPTY,
        defaultExpanded: true,
      }),
    );
    expect(html).not.toContain('data-testid="expand-description"');
    expect(html).toContain(EMPTY);
  });
});

describe("TaskDetailsDocumentSection snapshot persistence", () => {
  const writeClipboardMock = mock(async (_value: string) => {});
  let restoreClipboard: (() => void) | null = null;

  beforeEach(() => {
    writeClipboardMock.mockClear();
    writeClipboardMock.mockImplementation(async () => {});
    restoreClipboard = replaceNavigatorClipboard(writeClipboardMock);
  });

  afterEach(() => {
    restoreClipboard?.();
    restoreClipboard = null;
  });

  const renderSection = (markdown: string) =>
    render(
      createElement(TaskDetailsDocumentSection, {
        title: TITLE,
        icon: ICON,
        markdown,
        updatedAt: UPDATED_AT,
        empty: EMPTY,
        defaultExpanded: true,
      }),
    );

  test("modal retains original content after source becomes empty", () => {
    const originalMarkdown = "# Original description content";
    const { rerender } = renderSection(originalMarkdown);

    fireEvent.click(screen.getByTestId("expand-description"));

    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();

    rerender(
      createElement(TaskDetailsDocumentSection, {
        title: TITLE,
        icon: ICON,
        markdown: "",
        updatedAt: UPDATED_AT,
        empty: EMPTY,
        defaultExpanded: true,
      }),
    );

    // Expand button gone, modal still open with original content
    expect(screen.queryByTestId("expand-description")).toBeNull();
    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();
    // After source becomes empty, only the modal snapshot has the content (card is empty)
    const matching = screen.getAllByText((c) => c.includes("Original description content"));
    expect(matching.length).toBe(1);
  });

  test("copy button in modal copies snapshot markdown after source becomes empty", async () => {
    await withMockedToast(async () => {
      const originalMarkdown = "# Copy this description";
      const { rerender } = renderSection(originalMarkdown);

      fireEvent.click(screen.getByTestId("expand-description"));

      rerender(
        createElement(TaskDetailsDocumentSection, {
          title: TITLE,
          icon: ICON,
          markdown: "",
          updatedAt: UPDATED_AT,
          empty: EMPTY,
          defaultExpanded: true,
        }),
      );

      fireEvent.click(screen.getByTestId("markdown-preview-modal-copy"));
      expect(writeClipboardMock).toHaveBeenCalledWith("# Copy this description");
    });
  });
});
