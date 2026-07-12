import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { AgentStudioTerminalPanelModel } from "@/pages/agents/terminals/use-agent-studio-terminals";
import { AgentStudioTerminalPanel } from "./agent-studio-terminal-panel";

const model: AgentStudioTerminalPanelModel = {
  scopeKey: "/repo:task-1",
  taskId: "task-1",
  tabs: [
    {
      tabId: "lost:terminal-1",
      terminalId: null,
      summary: null,
      label: "Shell 1",
      error: "This terminal belonged to a previous host session.",
      requestState: "lost",
    },
  ],
  activeTabId: "lost:terminal-1",
  isVisible: true,
  isLoading: false,
  isCreating: false,
  connectionState: "disconnected",
  focusRequest: 0,
  controller: null,
  onToggle: () => undefined,
  onBackToChat: () => undefined,
  onSelectTab: () => undefined,
  onCreate: () => undefined,
  onRetryCreate: () => undefined,
  onClose: async () => undefined,
  onReconnect: () => undefined,
};

describe("AgentStudioTerminalPanel", () => {
  test("shows explicit lost-session and independent lifecycle/connection states", () => {
    render(<AgentStudioTerminalPanel model={model} />);
    expect(screen.getByText("This terminal belonged to a previous host session.")).toBeTruthy();
    expect(screen.getByText("Lifecycle: Lost after host restart")).toBeTruthy();
    expect(screen.getByText("Connection: disconnected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry terminal creation" })).toBeNull();
  });
});
