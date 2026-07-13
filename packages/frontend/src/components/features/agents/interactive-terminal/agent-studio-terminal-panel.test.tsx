import { describe, expect, mock, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      lifecycle: null,
      lifecycleFromEvent: false,
      label: "Shell 1",
      error: "This terminal belonged to a previous host session.",
      requestState: "lost",
    },
  ],
  activeTabId: "lost:terminal-1",
  isVisible: true,
  isLoading: false,
  isCreating: false,
  runningCount: 0,
  connectionState: "disconnected",
  transportError: null,
  focusRequest: 0,
  controller: null,
  onToggle: () => undefined,
  onBackToChat: () => undefined,
  onSelectTab: () => undefined,
  onCreate: () => undefined,
  onRetryCreate: () => undefined,
  onClose: async () => undefined,
  onReconnect: () => undefined,
  onLifecycle: () => undefined,
  onForgotten: () => undefined,
};

describe("AgentStudioTerminalPanel", () => {
  test("shows explicit lost-session and independent lifecycle/connection states", () => {
    render(<AgentStudioTerminalPanel model={model} />);
    expect(screen.getByText("This terminal belonged to a previous host session.")).toBeTruthy();
    expect(screen.getByText("Lifecycle: Lost after host restart")).toBeTruthy();
    expect(screen.getByText("Connection: disconnected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry terminal creation" })).toBeNull();
  });

  test("shows connection-global protocol failures", () => {
    render(
      <AgentStudioTerminalPanel
        model={{ ...model, transportError: "Unsupported terminal protocol version." }}
      />,
    );
    expect(
      screen.getByText("Terminal connection failed: Unsupported terminal protocol version."),
    ).toBeTruthy();
  });

  test("enforces the eight-terminal tab limit", () => {
    render(
      <AgentStudioTerminalPanel
        model={{
          ...model,
          tabs: Array.from({ length: 8 }, (_, index) => ({
            tabId: `lost:${index}`,
            terminalId: null,
            summary: null,
            lifecycle: null,
            lifecycleFromEvent: false,
            label: `Shell ${index + 1}`,
            error: "This terminal belonged to a previous host session.",
            requestState: "lost" as const,
          })),
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "New terminal" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  test("requires terminate-and-close confirmation for a running terminal", async () => {
    const onClose = mock(async () => undefined);
    const summary: TerminalSummary = {
      terminalId: "terminal-running",
      hostInstanceId: "host-1",
      label: "Shell 1",
      context: { taskId: "task-1" },
      initialWorkingDir: "/repo",
      initialWorkingDirAvailable: true,
      createdAt: "2026-07-12T00:00:00.000Z",
      lifecycle: "running",
      connectionState: "connected",
      attentionState: "none",
      exit: null,
    };
    render(
      <AgentStudioTerminalPanel
        model={{
          ...model,
          connectionState: "connected",
          runningCount: 1,
          tabs: [
            {
              tabId: "tab:terminal-running",
              terminalId: summary.terminalId,
              summary,
              lifecycle: "running",
              lifecycleFromEvent: false,
              label: summary.label,
              error: null,
              requestState: "ready",
            },
          ],
          activeTabId: "tab:terminal-running",
          onClose,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close Shell 1" }));
    expect(screen.getByText("Terminate and close Shell 1?")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Terminate and close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(expect.anything(), true));
  });

  test("exposes task, started-in path, lifecycle, connection, and semantic theme surfaces", () => {
    const summary: TerminalSummary = {
      terminalId: "terminal-running",
      hostInstanceId: "host-1",
      label: "Shell 1",
      context: { taskId: "task-1" },
      initialWorkingDir: "/repo/worktrees/task-1",
      initialWorkingDirAvailable: true,
      createdAt: "2026-07-12T00:00:00.000Z",
      lifecycle: "running",
      connectionState: "connected",
      attentionState: "none",
      exit: null,
    };
    const view = render(
      <div className="dark">
        <AgentStudioTerminalPanel
          model={{
            ...model,
            connectionState: "connected",
            runningCount: 1,
            tabs: [
              {
                tabId: "tab:terminal-running",
                terminalId: summary.terminalId,
                summary,
                lifecycle: "running",
                lifecycleFromEvent: false,
                label: summary.label,
                error: null,
                requestState: "ready",
              },
            ],
            activeTabId: "tab:terminal-running",
          }}
        />
      </div>,
    );

    expect(screen.getByRole("tab", { name: /Shell 1 Running/ })).toBeTruthy();
    expect(screen.getByText("Task: task-1")).toBeTruthy();
    expect(screen.getByText("Started in: /repo/worktrees/task-1")).toBeTruthy();
    expect(screen.getByText("Lifecycle: Running")).toBeTruthy();
    expect(screen.getByText("Connection: attaching")).toBeTruthy();
    const panel = view.container.querySelector(".bg-card");
    expect(panel?.className).toContain("border-border");
  });

  test("uses an exited lifecycle frame across every surface despite a stale running summary", async () => {
    const onClose = mock(async () => undefined);
    const summary: TerminalSummary = {
      terminalId: "terminal-exited",
      hostInstanceId: "host-1",
      label: "Shell 1",
      context: { taskId: "task-1" },
      initialWorkingDir: "/repo",
      initialWorkingDirAvailable: true,
      createdAt: "2026-07-12T00:00:00.000Z",
      lifecycle: "running",
      connectionState: "connected",
      attentionState: "none",
      exit: null,
    };
    render(
      <AgentStudioTerminalPanel
        model={{
          ...model,
          tabs: [
            {
              tabId: "tab:terminal-exited",
              terminalId: summary.terminalId,
              summary,
              lifecycle: "exited",
              lifecycleFromEvent: true,
              label: summary.label,
              error: null,
              requestState: "ready",
            },
          ],
          activeTabId: "tab:terminal-exited",
          onClose,
        }}
      />,
    );
    expect(screen.getByRole("tab", { name: /Shell 1 Exited/ })).toBeTruthy();
    expect(screen.getByText("0 running")).toBeTruthy();
    expect(screen.getByText("Lifecycle: Exited")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Shell 1" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(expect.anything(), false));
    expect(screen.queryByText("Terminate and close Shell 1?")).toBeNull();
  });
});
