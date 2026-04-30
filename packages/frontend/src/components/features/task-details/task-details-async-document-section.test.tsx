import { describe, expect, test } from "bun:test";
import { FileCode } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskDetailsAsyncDocumentSection } from "./task-details-async-document-section";
import type { TaskDocumentState } from "./use-task-documents";

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
