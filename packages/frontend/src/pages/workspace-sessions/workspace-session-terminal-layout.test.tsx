import { expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import type { TerminalPanelModel } from "@/features/terminals";
import { WorkspaceSessionTerminalLayout } from "./workspace-session-terminal-layout";

test("a narrow chat shows the terminal and Back returns to the workspace", () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = () => ({
    matches: true,
    media: "(max-width: 767px)",
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  });
  let hidden = false;
  const model: TerminalPanelModel = {
    scopeKey: "workspace-1:first",
    isAvailable: true,
    startBlockedReason: null,
    tabs: [],
    mountedTabs: [],
    activeTabId: null,
    isVisible: true,
    isLoading: false,
    isCreating: false,
    discoveryError: null,
    transportError: null,
    platform: "darwin",
    platformError: null,
    focusRequest: 0,
    controller: null,
    onToggle: () => undefined,
    onHide: () => {
      hidden = true;
    },
    onSelectTab: () => undefined,
    onCreate: () => undefined,
    onRunAction: () => undefined,
    onRetryDiscovery: () => undefined,
    onRetryCreate: () => undefined,
    onReorderTab: () => undefined,
    onTitleChange: () => undefined,
    onClose: async () => ({ closed: true }),
    onLifecycle: () => undefined,
    onForgotten: () => undefined,
  };
  let view: ReturnType<typeof render> | undefined;
  try {
    view = render(
      <WorkspaceSessionTerminalLayout model={model}>
        <p>Chat content</p>
      </WorkspaceSessionTerminalLayout>,
    );
    expect(view.getByText("Chat content").parentElement?.hidden).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Back to workspace" }));
    expect(hidden).toBe(true);
  } finally {
    view?.unmount();
    window.matchMedia = originalMatchMedia;
  }
});
