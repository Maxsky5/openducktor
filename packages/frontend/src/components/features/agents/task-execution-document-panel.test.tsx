import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import {
  type TaskDocumentKind,
  type TaskExecutionDocument,
  TaskExecutionDocumentPanel,
  type TaskExecutionDocumentPanelModel,
} from "./task-execution-document-panel";

enableReactActEnvironment();

const emptyDoc = {
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
};

const documentFor = (
  title: string,
  emptyState: string,
  document: Partial<TaskExecutionDocument["document"]> = {},
): TaskExecutionDocument => ({
  title,
  emptyState,
  document: { ...emptyDoc, ...document },
});

const documentModel = (
  selectedKind: TaskDocumentKind,
  documents: Partial<Record<TaskDocumentKind, TaskExecutionDocument>> = {},
  onSelectKind: (kind: TaskDocumentKind) => void = () => {},
): TaskExecutionDocumentPanelModel => ({
  documents: {
    spec: documents.spec ?? documentFor("Specification", "No spec document yet."),
    plan: documents.plan ?? documentFor("Implementation Plan", "No implementation plan yet."),
    qa: documents.qa ?? documentFor("QA Report", "No QA report yet."),
  },
  selectedKind,
  onSelectKind,
});

const renderModel = (model: TaskExecutionDocumentPanelModel): string =>
  renderToStaticMarkup(createElement(TaskExecutionDocumentPanel, { model }));

describe("TaskExecutionDocumentPanel", () => {
  test("renders the selected document content", () => {
    const html = renderModel(
      documentModel("spec", {
        spec: documentFor("Specification", "No spec document yet.", {
          markdown: "# Spec",
          updatedAt: "2026-02-21T10:00:00.000Z",
        }),
      }),
    );

    expect(html).toContain("Specification");
    expect(html).toContain('data-testid="copy-agent-studio-document-content"');
    expect(html).toContain('data-testid="expand-agent-studio-document"');
    expect(html).toMatch(/Feb 21(?:, \d{1,2}:\d{2}\s?[AP]M| at)/u);
  });

  test("renders the empty state of a document that does not exist yet", () => {
    const html = renderModel(documentModel("qa"));

    expect(html).toContain("No QA report yet.");
    expect(html).toContain("Not set");
    expect(html).not.toContain('data-testid="copy-agent-studio-document-content"');
    expect(html).not.toContain('data-testid="expand-agent-studio-document"');
  });

  test("renders loading state before an empty document has loaded", () => {
    const html = renderModel(
      documentModel("spec", {
        spec: documentFor("Specification", "No spec document yet.", {
          loaded: false,
          isLoading: true,
        }),
      }),
    );

    expect(html).toContain("Loading document...");
    expect(html).not.toContain("No spec document yet.");
  });

  test("renders an actionable document load error", () => {
    const html = renderModel(
      documentModel("spec", {
        spec: documentFor("Specification", "No spec document yet.", {
          error: "Unable to load specification.",
        }),
      }),
    );

    expect(html).toContain("Unable to load specification.");
    expect(html).not.toContain("No spec document yet.");
  });

  test("switches documents from the menu in the document title", () => {
    const onSelectKind = mock((_kind: TaskDocumentKind) => {});
    render(
      createElement(TaskExecutionDocumentPanel, {
        model: documentModel(
          "plan",
          {
            spec: documentFor("Specification", "No spec document yet.", {
              markdown: "# Spec",
              updatedAt: "2026-02-21T10:00:00.000Z",
            }),
          },
          onSelectKind,
        ),
      }),
    );
    expect(screen.getByText("No implementation plan yet.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Implementation Plan, change document" }));

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringMatching(/^SpecificationFeb 21/u),
      "Implementation PlanNot set",
      "QA ReportNot set",
    ]);
    fireEvent.click(screen.getByRole("option", { name: /QA Report/u }));

    expect(onSelectKind).toHaveBeenCalledWith("qa");
  });

  test("expand button is hidden when document markdown is empty", () => {
    const html = renderModel(documentModel("spec"));

    expect(html).not.toContain('data-testid="expand-agent-studio-document"');
  });
});

describe("TaskExecutionDocumentPanel snapshot persistence", () => {
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

  const activeDocuments = {
    spec: documentFor("Specification", "No spec document yet.", {
      markdown: "# Active spec content",
      updatedAt: "2026-02-21T10:00:00.000Z",
    }),
  };

  test("modal retains original content when the shown document changes", () => {
    const { rerender } = render(
      createElement(TaskExecutionDocumentPanel, { model: documentModel("spec", activeDocuments) }),
    );

    fireEvent.click(screen.getByTestId("expand-agent-studio-document"));

    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();

    rerender(createElement(TaskExecutionDocumentPanel, { model: documentModel("plan") }));

    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();
    // After the panel shows another document, only the modal snapshot has the content.
    const matching = screen.getAllByText((content) => content.includes("Active spec content"));
    expect(matching.length).toBe(1);
  });

  test("copy button in modal copies snapshot markdown after the shown document changes", async () => {
    await withMockedToast(async () => {
      const { rerender } = render(
        createElement(TaskExecutionDocumentPanel, {
          model: documentModel("spec", activeDocuments),
        }),
      );

      fireEvent.click(screen.getByTestId("expand-agent-studio-document"));

      rerender(createElement(TaskExecutionDocumentPanel, { model: documentModel("plan") }));

      fireEvent.click(screen.getByTestId("markdown-preview-modal-copy"));
      expect(writeClipboardMock).toHaveBeenCalledWith("# Active spec content");
    });
  });
});
