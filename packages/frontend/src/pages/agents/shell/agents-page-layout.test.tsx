import { describe, expect, test } from "bun:test";
import { act, render as testingLibraryRender } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import type { AgentStudioTerminalPanelModel } from "../terminals/use-agent-studio-terminals";
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

describe("AgentsPageWorkspace terminal visibility", () => {
  test("keeps the terminal panel mounted while hiding and reopening it", () => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    })) as typeof window.matchMedia;
    const terminalPanel: AgentStudioTerminalPanelModel = {
      scopeKey: "repo:task-1",
      isAvailable: true,
      tabs: [],
      mountedTabs: [],
      activeTabId: null,
      isVisible: true,
      isLoading: false,
      isCreating: false,
      transportError: null,
      platform: "darwin",
      platformError: null,
      focusRequest: 1,
      controller: null,
      onToggle: () => undefined,
      onHide: () => undefined,
      onSelectTab: () => undefined,
      onCreate: () => undefined,
      onRetryCreate: () => undefined,
      onReorderTab: () => undefined,
      onTitleChange: () => undefined,
      onClose: async () => ({ closed: true }),
      onLifecycle: () => undefined,
      onForgotten: () => undefined,
    };
    const renderWorkspace = (isVisible: boolean) =>
      createElement(AgentsPageWorkspace, {
        hasSelectedTask: true,
        chatContent: createElement("div", null, "Chat"),
        hasSelectedFilePreview: false,
        selectedFilePreviewContent: null,
        isRightPanelVisible: false,
        rightPanelContent: null,
        terminalPanel: { ...terminalPanel, isVisible },
      });
    const view = render(renderWorkspace(false));
    const panel = view.getByText("No terminals.");
    const workspacePanel = view.container.querySelector<HTMLElement>(
      "#agent-studio-workspace-panel",
    );
    const hiddenTerminalPanel = view.container.querySelector<HTMLElement>(
      "#agent-studio-terminal-panel",
    );
    expect(workspacePanel?.style.flexGrow).toBe("100");
    expect(hiddenTerminalPanel?.style.flexGrow).toBe("0");
    expect(view.queryByRole("separator", { name: "Resize terminal panel" })).toBeNull();

    view.rerender(renderWorkspace(true));
    const separator = view.getByRole("separator", { name: "Resize terminal panel" });
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
    expect(view.getByText("No terminals.")).toBe(panel);
    view.rerender(renderWorkspace(true));
    expect(view.getByText("No terminals.")).toBe(panel);
  });

  test("uses terminal mode at 767px and keeps a path back to the workspace", () => {
    window.matchMedia = ((query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    })) as typeof window.matchMedia;
    const onHide = () => undefined;
    const terminalPanel: AgentStudioTerminalPanelModel = {
      scopeKey: "repo:task-1",
      isAvailable: true,
      tabs: [],
      mountedTabs: [],
      activeTabId: null,
      isVisible: true,
      isLoading: false,
      isCreating: false,
      transportError: null,
      platform: "darwin",
      platformError: null,
      focusRequest: 1,
      controller: null,
      onToggle: () => undefined,
      onHide,
      onSelectTab: () => undefined,
      onCreate: () => undefined,
      onRetryCreate: () => undefined,
      onReorderTab: () => undefined,
      onTitleChange: () => undefined,
      onClose: async () => ({ closed: true }),
      onLifecycle: () => undefined,
      onForgotten: () => undefined,
    };
    const view = render(
      createElement(AgentsPageWorkspace, {
        hasSelectedTask: true,
        chatContent: createElement("div", { "data-testid": "narrow-chat" }, "Chat"),
        hasSelectedFilePreview: false,
        selectedFilePreviewContent: null,
        isRightPanelVisible: false,
        rightPanelContent: null,
        terminalPanel,
      }),
    );
    expect(view.getByRole("button", { name: "Back to workspace" })).toBeTruthy();
    expect(view.getByTestId("narrow-chat").closest("[hidden]")).toBeTruthy();
    expect(view.getByText("No terminals.").closest("[hidden]")).toBeNull();
  });
});
