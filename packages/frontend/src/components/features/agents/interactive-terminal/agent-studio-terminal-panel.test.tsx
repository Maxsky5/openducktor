import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AgentStudioTerminalPanelModel } from "@/pages/agents/terminals/use-agent-studio-terminals";
import { AgentStudioTerminalPanel } from "./agent-studio-terminal-panel";

const model = (onHide: () => void): AgentStudioTerminalPanelModel => ({
  scopeKey: "/repo:task-1",
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
  focusRequest: 0,
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
});

describe("AgentStudioTerminalPanel", () => {
  test("adapts the generic terminal panel to narrow Agent Studio navigation", () => {
    const onHide = mock(() => undefined);
    render(<AgentStudioTerminalPanel model={model(onHide)} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to workspace" }));

    expect(onHide).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No terminals.")).toBeTruthy();
  });
});
