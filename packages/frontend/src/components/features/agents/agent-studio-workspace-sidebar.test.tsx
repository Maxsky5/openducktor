import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import { AgentStudioWorkspaceSidebar } from "./agent-studio-workspace-sidebar";

enableReactActEnvironment();

const emptyDoc = {
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
};

describe("AgentStudioWorkspaceSidebar", () => {
  test("renders active document content", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioWorkspaceSidebar, {
        model: {
          activeDocument: {
            title: "Specification",
            description: "Current specification document for this task.",
            emptyState: "No spec document yet.",
            document: {
              ...emptyDoc,
              markdown: "# Spec",
              updatedAt: "2026-02-21T10:00:00.000Z",
            },
          },
        },
      }),
    );

    expect(html).toContain("Specification");
    expect(html).toContain("Current specification document for this task.");
    expect(html).toContain("Spec");
    expect(html).toContain('data-testid="copy-agent-studio-document-content"');
    expect(html).toContain('data-testid="expand-agent-studio-document"');
    expect(html).toMatch(/Feb 21(?:, \d{1,2}:\d{2}\s?[AP]M| at)/u);
  });

  test("renders active document placeholder when document is empty", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioWorkspaceSidebar, {
        model: {
          activeDocument: {
            title: "QA Report",
            description: "Latest QA report for this task.",
            emptyState: "No QA report yet.",
            document: {
              ...emptyDoc,
            },
          },
        },
      }),
    );

    expect(html).toContain("No QA report yet.");
    expect(html).toContain("Not set");
    expect(html).not.toContain('data-testid="copy-agent-studio-document-content"');
    expect(html).not.toContain('data-testid="expand-agent-studio-document"');
  });

  test("renders empty sidebar for Builder role documents", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioWorkspaceSidebar, {
        model: {
          activeDocument: null,
        },
      }),
    );

    expect(html).not.toContain("Specification");
  });

  test("expand button is hidden when document markdown is empty", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioWorkspaceSidebar, {
        model: {
          activeDocument: {
            title: "Specification",
            description: "Current specification document.",
            emptyState: "No spec document yet.",
            document: {
              ...emptyDoc,
              markdown: "",
            },
          },
        },
      }),
    );

    expect(html).not.toContain('data-testid="expand-agent-studio-document"');
  });
});

describe("AgentStudioWorkspaceSidebar snapshot persistence", () => {
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

  const activeDoc = {
    title: "Specification",
    description: "Current specification document.",
    emptyState: "No spec document yet.",
    document: {
      markdown: "# Active spec content",
      updatedAt: "2026-02-21T10:00:00.000Z",
      isLoading: false,
      error: null,
      loaded: true,
    },
  };

  test("modal retains original content when activeDocument becomes null", () => {
    const { rerender } = render(
      createElement(AgentStudioWorkspaceSidebar, {
        model: { activeDocument: activeDoc },
      }),
    );

    fireEvent.click(screen.getByTestId("expand-agent-studio-document"));

    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();

    rerender(
      createElement(AgentStudioWorkspaceSidebar, {
        model: { activeDocument: null },
      }),
    );

    expect(screen.getByTestId("markdown-preview-modal-copy")).toBeDefined();
    // After sidebar becomes null, only the modal snapshot has the content (sidebar is empty)
    const matching = screen.getAllByText((c) => c.includes("Active spec content"));
    expect(matching.length).toBe(1);
  });

  test("copy button in modal copies snapshot markdown after activeDocument becomes null", async () => {
    await withMockedToast(async () => {
      const { rerender } = render(
        createElement(AgentStudioWorkspaceSidebar, {
          model: { activeDocument: activeDoc },
        }),
      );

      fireEvent.click(screen.getByTestId("expand-agent-studio-document"));

      rerender(
        createElement(AgentStudioWorkspaceSidebar, {
          model: { activeDocument: null },
        }),
      );

      fireEvent.click(screen.getByTestId("markdown-preview-modal-copy"));
      expect(writeClipboardMock).toHaveBeenCalledWith("# Active spec content");
    });
  });
});
