import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentStudioRightPanel,
  AgentStudioRightPanelToggleButton,
} from "./agent-studio-right-panel";

const emptyDoc = {
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
};

describe("AgentStudioRightPanelToggleButton", () => {
  test("renders hide label when documents panel is open", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioRightPanelToggleButton, {
        model: {
          kind: "documents",
          isOpen: true,
          onToggle: () => {},
        },
      }),
    );

    expect(html).toContain("Hide documents panel");
  });

  test("renders show label when diff panel is closed", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioRightPanelToggleButton, {
        model: {
          kind: "diff",
          isOpen: false,
          onToggle: () => {},
        },
      }),
    );

    expect(html).toContain("Show file diff panel");
  });
});

describe("AgentStudioRightPanel", () => {
  test("renders documents content via workspace sidebar", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioRightPanel, {
        model: {
          kind: "documents",
          documentsModel: {
            activeDocument: {
              title: "Specification",
              description: "Current specification document for this task.",
              emptyState: "No spec document yet.",
              document: {
                ...emptyDoc,
                markdown: "# Spec",
              },
            },
          },
        },
      }),
    );

    expect(html).toContain("Specification");
    expect(html).toContain("Current specification document for this task.");
    expect(html).toContain("Spec");
  });

  test("renders diff placeholder when diff panel kind is selected", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioRightPanel, {
        model: {
          kind: "diff",
          documentsModel: {
            activeDocument: null,
          },
        },
      }),
    );

    expect(html).toContain("File Diff");
    expect(html).toContain("Latest builder file changes for this task session.");
    expect(html).toContain("File diff panel is not available yet.");
  });
});
