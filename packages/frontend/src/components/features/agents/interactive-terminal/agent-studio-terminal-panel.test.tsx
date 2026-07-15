import { describe, expect, mock, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AgentStudioTerminalPanelModel,
  AgentStudioTerminalTab,
} from "@/pages/agents/terminals/use-agent-studio-terminals";
import { AgentStudioTerminalPanel } from "./agent-studio-terminal-panel";

const lostTab: AgentStudioTerminalTab = {
  tabId: "lost:terminal-1",
  terminalId: null,
  summary: null,
  lifecycle: null,
  lifecycleFromEvent: false,
  label: "Shell 1",
  error: "This terminal belonged to a previous host session.",
  requestState: "lost",
};

const tabsModel = (tabs: AgentStudioTerminalTab[]) => ({ tabs, mountedTabs: tabs });

const model: AgentStudioTerminalPanelModel = {
  scopeKey: "/repo:task-1",
  taskId: "task-1",
  ...tabsModel([lostTab]),
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
  onClose: async () => ({ closed: true }),
  onReconnect: () => undefined,
  onLifecycle: () => undefined,
  onForgotten: () => undefined,
};

describe("AgentStudioTerminalPanel", () => {
  test("shows explicit lost-session and independent lifecycle/connection states", () => {
    render(<AgentStudioTerminalPanel model={model} />);
    expect(screen.getByText("This terminal belonged to a previous host session.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Shell 1, Lost after host restart" })).toBeTruthy();
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

  test("keeps a hidden closing terminal viewport mounted", () => {
    const view = render(<AgentStudioTerminalPanel model={model} />);
    const terminalViewport = screen.getByText("This terminal belonged to a previous host session.");

    view.rerender(
      <AgentStudioTerminalPanel
        model={{ ...model, tabs: [], activeTabId: null, mountedTabs: [lostTab] }}
      />,
    );

    expect(screen.queryByRole("tab", { name: "Shell 1, Lost after host restart" })).toBeNull();
    expect(screen.queryByText("No terminals for this task.")).toBeNull();
    expect(screen.getByText("This terminal belonged to a previous host session.")).toBe(
      terminalViewport,
    );
  });

  test("enforces the eight-terminal tab limit", () => {
    render(
      <AgentStudioTerminalPanel
        model={{
          ...model,
          ...tabsModel(
            Array.from({ length: 8 }, (_, index) => ({
              tabId: `lost:${index}`,
              terminalId: null,
              summary: null,
              lifecycle: null,
              lifecycleFromEvent: false,
              label: `Shell ${index + 1}`,
              error: "This terminal belonged to a previous host session.",
              requestState: "lost" as const,
            })),
          ),
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "New terminal" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  test("closes an idle running shell without confirmation", async () => {
    const onClose = mock(async () => ({ closed: true as const }));
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
          ...tabsModel([
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
          ]),
          activeTabId: "tab:terminal-running",
          onClose,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close Shell 1" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(expect.anything(), false));
    expect(screen.queryByText("Terminate and close Shell 1?")).toBeNull();
  });

  test("confirms only after the host reports a blocking command", async () => {
    const onClose = mock(async (_tab, confirmTerminate: boolean) =>
      confirmTerminate
        ? { closed: true as const }
        : { closed: false as const, confirmationRequired: true as const },
    );
    const summary: TerminalSummary = {
      terminalId: "terminal-busy",
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
          ...tabsModel([
            {
              tabId: "tab:terminal-busy",
              terminalId: summary.terminalId,
              summary,
              lifecycle: "running",
              lifecycleFromEvent: false,
              label: summary.label,
              error: null,
              requestState: "ready",
            },
          ]),
          activeTabId: "tab:terminal-busy",
          onClose,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close Shell 1" }));
    await waitFor(() => expect(screen.getByText("Terminate and close Shell 1?")).toBeTruthy());
    expect(onClose).toHaveBeenCalledWith(expect.anything(), false);
    const dialog = screen.getByRole("dialog");
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const confirmButton = screen.getByRole("button", { name: "Terminate and close" });
    const footer = cancelButton.parentElement;
    expect(dialog.className).toContain("max-w-lg");
    expect(footer?.className).toContain("justify-between");
    expect(footer?.className).toContain("border-t");
    expect(footer?.firstElementChild).toBe(cancelButton);
    expect(footer?.lastElementChild).toBe(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(expect.anything(), true));
  });

  test("shows immediate feedback while a terminal close is pending", () => {
    const summary: TerminalSummary = {
      terminalId: "terminal-closing",
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
          ...tabsModel([
            {
              tabId: "tab:terminal-closing",
              terminalId: summary.terminalId,
              summary,
              lifecycle: "closing",
              lifecycleFromEvent: false,
              label: summary.label,
              error: null,
              requestState: "ready",
            },
          ]),
          activeTabId: "tab:terminal-closing",
        }}
      />,
    );

    const closeButton = screen.getByRole("button", { name: "Close Shell 1" });
    expect(closeButton.hasAttribute("disabled")).toBe(true);
    expect(closeButton.getAttribute("aria-busy")).toBe("true");
    expect(closeButton.querySelector(".animate-spin")).toBeTruthy();
  });

  test("reuses compact Dev Server terminal chrome without muted icon actions", () => {
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
            ...tabsModel([
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
            ]),
            activeTabId: "tab:terminal-running",
          }}
        />
      </div>,
    );

    expect(screen.getByRole("tab", { name: "Shell 1, Running" })).toBeTruthy();
    expect(screen.queryByText("Started in: /repo/worktrees/task-1")).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.queryByText("Task: task-1")).toBeNull();
    expect(screen.queryByText("1 running")).toBeNull();
    const createButton = screen.getByRole("button", { name: "New terminal" });
    expect(createButton.textContent).toBe("");
    expect(createButton.className).not.toContain("bg-primary");
    expect(createButton.className).toContain("text-(--dev-server-terminal-foreground)");
    expect(createButton.className).not.toContain("text-muted-foreground");
    expect(createButton.className).not.toContain(" opacity-");
    const tab = screen.getByRole("tab", { name: "Shell 1, Running" });
    const closeButton = screen.getByRole("button", { name: "Close Shell 1" });
    expect(closeButton.parentElement).toBe(tab.parentElement);
    expect(tab.parentElement?.className).not.toContain("rounded-md");
    expect(tab.className).toContain("h-8");
    expect(tab.className).toContain("rounded-none");
    expect(tab.className).toContain("font-mono");
    expect(tab.className).toContain("text-[11px]");
    expect(tab.className).toContain("bg-(--dev-server-terminal-tab-inactive)");
    expect(tab.className).toContain("data-[state=active]:border-t-selected-accent");
    expect(tab.className).toContain("data-[state=active]:bg-(--dev-server-terminal-tab-active)");
    expect(closeButton.className).not.toContain(" opacity-");
    const panel = view.container.querySelector(".bg-card");
    expect(panel).toBeNull();
  });

  test("shows the terminal surface immediately while creation is pending", () => {
    render(
      <AgentStudioTerminalPanel
        model={{
          ...model,
          connectionState: "connected",
          ...tabsModel([
            {
              tabId: "creating:terminal",
              terminalId: null,
              summary: null,
              lifecycle: null,
              lifecycleFromEvent: false,
              label: "Shell 1",
              error: null,
              requestState: "creating",
            },
          ]),
          activeTabId: "creating:terminal",
          isCreating: true,
        }}
      />,
    );

    expect(screen.queryByText("Creating terminal…")).toBeNull();
    const surface = screen.getByTestId("agent-studio-terminal-starting-surface");
    expect(surface.className).toContain("bg-[var(--dev-server-terminal-panel)]");
  });

  test("uses an exited lifecycle frame across every surface despite a stale running summary", async () => {
    const onClose = mock(async () => ({ closed: true as const }));
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
          ...tabsModel([
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
          ]),
          activeTabId: "tab:terminal-exited",
          onClose,
        }}
      />,
    );
    expect(screen.getByRole("tab", { name: "Shell 1, Exited" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Shell 1" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(expect.anything(), false));
    expect(screen.queryByText("Terminate and close Shell 1?")).toBeNull();
  });
});
