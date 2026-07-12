import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { AgentsPageWorkspacePanes } from "./agents-page-layout";

const renderWorkspacePanes = (hasSelectedFilePreview: boolean) =>
  render(
    createElement(AgentsPageWorkspacePanes, {
      chatContent: createElement("div", { "data-testid": "mock-chat" }, "Chat"),
      hasSelectedFilePreview,
      selectedFilePreviewContent: createElement(
        "div",
        { "data-testid": "mock-file-preview" },
        "Preview",
      ),
      isRightPanelVisible: false,
      rightPanelContent: null,
    }),
  );

describe("AgentsPageWorkspacePanes", () => {
  test("hides the chat pane while the selected file preview owns the left pane", () => {
    const view = renderWorkspacePanes(true);

    expect(view.getByTestId("mock-file-preview")).toBeTruthy();
    expect(view.getByTestId("task-execution-selected-file-preview-pane").className).toContain(
      "h-full",
    );
    expect(view.getByTestId("agent-studio-chat-pane").hasAttribute("hidden")).toBe(true);
  });

  test("shows the chat pane when no file preview is selected", () => {
    const view = renderWorkspacePanes(false);

    expect(view.queryByTestId("mock-file-preview")).toBeNull();
    expect(view.getByTestId("agent-studio-chat-pane").hasAttribute("hidden")).toBe(false);
  });
});
