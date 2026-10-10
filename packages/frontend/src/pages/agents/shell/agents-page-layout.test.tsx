import { describe, expect, test } from "bun:test";
import { act, fireEvent, render as testingLibraryRender } from "@testing-library/react";
import { type ChangeEvent, createElement, type ReactElement, useState } from "react";
import { QueryProvider } from "@/lib/query-provider";
import {
  createSessionPanelFixture,
  createSessionPanelsFixture,
} from "@/test-utils/session-panel-fixtures";
import { AgentsPageWorkspace, AgentsPageWorkspacePanes } from "./agents-page-layout";

const render = (element: ReactElement) => {
  const result = testingLibraryRender(
    createElement(QueryProvider, { useIsolatedClient: true }, element),
  );
  return {
    ...result,
    rerender: (next: ReactElement) =>
      result.rerender(createElement(QueryProvider, { useIsolatedClient: true }, next)),
  };
};

const renderWorkspacePanes = (hasSelectedFilePreview: boolean) =>
  render(
    createElement(AgentsPageWorkspacePanes, {
      workflowContent: null,
      chatContent: createElement("div", { "data-testid": "mock-chat" }, "Chat"),
      hasSelectedFilePreview,
      selectedFilePreviewContent: createElement(
        "div",
        { "data-testid": "mock-file-preview" },
        "Preview",
      ),
      rightPanelContent: null,
      rightPanel: createSessionPanelFixture({ isVisible: false }),
    }),
  );

function DraftPreviewHarness(): ReactElement {
  const [contents, setContents] = useState("saved");
  return createElement("textarea", {
    "aria-label": "Draft preview",
    value: contents,
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setContents(event.target.value),
  });
}

describe("AgentsPageWorkspacePanes", () => {
  test("hides the chat pane while the selected file preview owns the left pane", () => {
    const view = renderWorkspacePanes(true);

    expect(view.getByTestId("mock-file-preview")).toBeTruthy();
    expect(view.getByTestId("task-execution-selected-file-preview-pane").className).toContain(
      "h-full",
    );
    expect(view.getByTestId("agent-studio-chat-pane").hasAttribute("hidden")).toBe(false);
    expect(view.getByTestId("agent-studio-chat-pane").style.visibility).toBe("hidden");
    expect(view.getByTestId("agent-studio-chat-pane").hasAttribute("inert")).toBe(true);
  });

  test("shows the chat pane when no file preview is selected", () => {
    const view = renderWorkspacePanes(false);

    expect(view.queryByTestId("mock-file-preview")).toBeNull();
    expect(view.getByTestId("agent-studio-chat-pane").style.visibility).toBe("");
    expect(view.getByTestId("agent-studio-chat-pane").hasAttribute("inert")).toBe(false);
    expect(view.getByTestId("agent-studio-chat-pane").hasAttribute("hidden")).toBe(false);
  });
});

describe("AgentsPageWorkspace bottom panel visibility", () => {
  test("keeps the selected file draft mounted across responsive layout changes", () => {
    let isNarrow = false;
    const listeners = new Set<EventListener>();
    const mediaQueryList = {
      get matches() {
        return isNarrow;
      },
      media: "(max-width: 1023px)",
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (_type: string, listener: EventListener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: EventListener) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => true,
    } satisfies MediaQueryList;
    window.matchMedia = () => mediaQueryList;
    const panelsFor = (isVisible: boolean) =>
      createSessionPanelsFixture({
        bottom: createSessionPanelFixture({
          panel: "bottom",
          tabs: [],
          selectedTabId: null,
          isVisible,
          onHide: () => undefined,
        }),
      });
    const view = render(
      createElement(AgentsPageWorkspace, {
        unavailableTaskId: null,
        headerContent: null,
        workflowContent: null,
        hasSelectedTask: true,
        chatContent: createElement("div", null, "Chat"),
        hasSelectedFilePreview: true,
        selectedFilePreviewContent: createElement(DraftPreviewHarness),
        rightPanelContent: null,
        panels: panelsFor(false),
      }),
    );
    const draft = view.getByRole("textbox", { name: "Draft preview" });
    if (!(draft instanceof HTMLTextAreaElement)) {
      throw new TypeError("Expected draft preview to be a textarea.");
    }
    fireEvent.change(draft, { target: { value: "unsaved draft" } });

    isNarrow = true;
    act(() => {
      const event = new Event("change");
      for (const listener of listeners) {
        listener(event);
      }
    });

    expect(view.getByRole("textbox", { name: "Draft preview" })).toBe(draft);
    expect(draft.value).toBe("unsaved draft");
  });

  test("keeps the bottom panel mounted while hiding and reopening it", () => {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    });
    const panelsFor = (isVisible: boolean) =>
      createSessionPanelsFixture({
        bottom: createSessionPanelFixture({
          panel: "bottom",
          tabs: [],
          selectedTabId: null,
          isVisible,
          onHide: () => undefined,
        }),
      });
    const renderWorkspace = (isVisible: boolean) =>
      createElement(AgentsPageWorkspace, {
        unavailableTaskId: null,
        headerContent: null,
        workflowContent: null,
        hasSelectedTask: true,
        chatContent: createElement("div", null, "Chat"),
        hasSelectedFilePreview: false,
        selectedFilePreviewContent: null,
        rightPanelContent: null,
        panels: panelsFor(isVisible),
      });
    const view = render(renderWorkspace(false));
    const panel = view.getByLabelText("Open a tab");
    const workspacePanel = view.container.querySelector<HTMLElement>(
      "#agent-studio-workspace-panel",
    );
    const hiddenTerminalPanel = view.container.querySelector<HTMLElement>(
      "#agent-studio-terminal-panel",
    );
    expect(workspacePanel?.style.flexGrow).toBe("100");
    expect(hiddenTerminalPanel?.style.flexGrow).toBe("0");
    expect(view.queryByRole("separator", { name: "Resize bottom panel" })).toBeNull();

    view.rerender(renderWorkspace(true));
    const separator = view.getByRole("separator", { name: "Resize bottom panel" });
    expect(workspacePanel?.style.flexGrow).toBe("72");
    expect(hiddenTerminalPanel?.style.flexGrow).toBe("28");
    expect(separator.getAttribute("aria-orientation")).toBe("horizontal");
    expect(separator.tabIndex).toBe(0);
    expect(separator.querySelector("svg")).not.toBeNull();
    expect(separator.className).toContain("aria-[orientation=horizontal]:h-3");
    act(() => separator.focus());
    expect(document.activeElement).toBe(separator);

    view.rerender(renderWorkspace(false));
    expect(workspacePanel?.style.flexGrow).toBe("100");
    expect(hiddenTerminalPanel?.style.flexGrow).toBe("0");
    expect(view.getByLabelText("Open a tab")).toBe(panel);
    view.rerender(renderWorkspace(true));
    expect(view.getByLabelText("Open a tab")).toBe(panel);
  });

  test("fills the page with the bottom panel at 767px and keeps a path back", () => {
    window.matchMedia = (query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    });
    let hideCount = 0;
    const onHide = () => {
      hideCount += 1;
    };
    const panelsFor = (isVisible: boolean) =>
      createSessionPanelsFixture({
        bottom: createSessionPanelFixture({
          panel: "bottom",
          tabs: [],
          selectedTabId: null,
          isVisible,
          onHide: onHide,
        }),
      });
    const view = render(
      createElement(AgentsPageWorkspace, {
        unavailableTaskId: null,
        headerContent: createElement("header", null, "Session toolbar"),
        workflowContent: createElement("nav", { "aria-label": "Task workflow" }, "Task workflow"),
        hasSelectedTask: true,
        chatContent: createElement("div", { "data-testid": "narrow-chat" }, "Chat"),
        hasSelectedFilePreview: false,
        selectedFilePreviewContent: null,
        rightPanelContent: null,
        panels: panelsFor(true),
      }),
    );
    expect(view.getByRole("button", { name: "Back to workspace" })).toBeTruthy();
    expect(view.getByText("Session toolbar").closest("[hidden]") === null).toBe(true);
    expect(view.getByText("Session toolbar").closest("[data-panel]")).toBeNull();
    expect(view.getByText("Task workflow").closest("[hidden]")).toBeTruthy();
    expect(view.getByTestId("narrow-chat").closest("[hidden]")).toBeTruthy();
    expect(view.getByLabelText("Open a tab").closest("[hidden]")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Back to workspace" }));
    expect(hideCount).toBe(1);
  });
});
