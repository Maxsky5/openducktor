import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
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
});
