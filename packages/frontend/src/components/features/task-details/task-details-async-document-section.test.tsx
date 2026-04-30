import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileCode } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import { TaskDetailsAsyncDocumentSection } from "./task-details-async-document-section";
import type { TaskDocumentState } from "./use-task-documents";

enableReactActEnvironment();

const EMPTY_LABEL = "No implementation plan yet.";

const buildDocument = (overrides: Partial<TaskDocumentState> = {}): TaskDocumentState => ({
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: false,
  ...overrides,
});

describe("TaskDetailsAsyncDocumentSection", () => {
  test("shows loading skeleton before the first document load completes", () => {
    const html = renderToStaticMarkup(
      createElement(TaskDetailsAsyncDocumentSection, {
        title: "Implementation Plan",
        icon: createElement(FileCode, { className: "size-3.5" }),
        empty: EMPTY_LABEL,
        document: buildDocument(),
        hasDocument: true,
        defaultExpanded: true,
        onLoad: () => {},
      }),
    );

    expect(html).toContain("animate-pulse");
    expect(html).not.toContain(EMPTY_LABEL);
    expect(html).not.toContain('data-testid="expand-implementation-plan"');
  });

  test("shows empty-state copy only after load completes with empty markdown", () => {
    const html = renderToStaticMarkup(
      createElement(TaskDetailsAsyncDocumentSection, {
        title: "Implementation Plan",
        icon: createElement(FileCode, { className: "size-3.5" }),
        empty: EMPTY_LABEL,
        document: buildDocument({ loaded: true }),
        hasDocument: true,
        defaultExpanded: true,
        onLoad: () => {},
      }),
    );

    expect(html).toContain(EMPTY_LABEL);
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain('data-testid="expand-implementation-plan"');
  });

  test("shows empty-state copy immediately when section has no document", () => {
    const html = renderToStaticMarkup(
      createElement(TaskDetailsAsyncDocumentSection, {
        title: "Implementation Plan",
        icon: createElement(FileCode, { className: "size-3.5" }),
        empty: EMPTY_LABEL,
        document: buildDocument(),
        hasDocument: false,
        defaultExpanded: true,
        onLoad: () => {},
      }),
    );

    expect(html).toContain(EMPTY_LABEL);
    expect(html).toContain("No document");
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain('data-testid="expand-implementation-plan"');
  });

  test("renders expand button when document is loaded and non-empty", () => {
    const html = renderToStaticMarkup(
      createElement(TaskDetailsAsyncDocumentSection, {
        title: "Implementation Plan",
        icon: createElement(FileCode, { className: "size-3.5" }),
        empty: EMPTY_LABEL,
        document: buildDocument({ loaded: true, markdown: "# My Plan" }),
        hasDocument: true,
        defaultExpanded: true,
        onLoad: () => {},
      }),
    );

    expect(html).toContain('data-testid="expand-implementation-plan"');
    expect(html).not.toContain(EMPTY_LABEL);
  });
});

describe("TaskDetailsAsyncDocumentSection snapshot persistence", () => {
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

  const ICON = createElement(FileCode, { className: "size-3.5" });
  const TITLE = "Implementation Plan";
  const TEST_ID = "expand-implementation-plan";
  const ORIGINAL_MARKDOWN = "# Original plan content";

  const loadedDoc: TaskDocumentState = {
    markdown: ORIGINAL_MARKDOWN,
    updatedAt: "2026-01-01T00:00:00Z",
    isLoading: false,
    error: null,
    loaded: true,
  };

  const baseProps = {
    title: TITLE,
    icon: ICON,
    empty: EMPTY_LABEL,
    hasDocument: true,
    defaultExpanded: true,
    onLoad: () => {},
  };

  const renderSection = (document: TaskDocumentState) =>
    render(
      createElement(TaskDetailsAsyncDocumentSection, {
        ...baseProps,
        document,
      }),
    );

  test("modal retains original content when document starts loading", () => {
    const { rerender } = renderSection(loadedDoc);

    fireEvent.click(screen.getByTestId(TEST_ID));

    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();

    rerender(
      createElement(TaskDetailsAsyncDocumentSection, {
        ...baseProps,
        document: { ...loadedDoc, isLoading: true },
      }),
    );

    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();
    expect(
      screen.getAllByText((c) => c.includes("Original plan content")).length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("modal retains original content when document becomes empty", () => {
    const { rerender } = renderSection(loadedDoc);

    fireEvent.click(screen.getByTestId(TEST_ID));

    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();

    rerender(
      createElement(TaskDetailsAsyncDocumentSection, {
        ...baseProps,
        document: { ...loadedDoc, markdown: "" },
      }),
    );

    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();
    // After source becomes empty, only the modal snapshot has the content (card is empty)
    const matching = screen.getAllByText((c) => c.includes("Original plan content"));
    expect(matching.length).toBe(1);
  });

  test("copy button in modal copies snapshot markdown after document becomes empty", async () => {
    await withMockedToast(async () => {
      const { rerender } = renderSection(loadedDoc);

      fireEvent.click(screen.getByTestId(TEST_ID));

      rerender(
        createElement(TaskDetailsAsyncDocumentSection, {
          ...baseProps,
          document: { ...loadedDoc, markdown: "" },
        }),
      );

      fireEvent.click(screen.getByTestId("markdown-preview-modal-copy"));
      expect(writeClipboardMock).toHaveBeenCalledWith(ORIGINAL_MARKDOWN);
    });
  });
});
