import { describe, expect, mock, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import {
  act,
  fireEvent,
  screen,
  render as testingLibraryRender,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import type {
  AgentStudioTerminalPanelModel,
  AgentStudioTerminalTab,
} from "@/pages/agents/terminals/use-agent-studio-terminals";
import { AgentStudioTerminalPanel } from "./agent-studio-terminal-panel";

const render = (element: ReactElement) => {
  const result = testingLibraryRender(<QueryProvider useIsolatedClient>{element}</QueryProvider>);
  return {
    ...result,
    rerender: (next: ReactElement) =>
      result.rerender(<QueryProvider useIsolatedClient>{next}</QueryProvider>),
  };
};

const lostTab: AgentStudioTerminalTab = {
  tabId: "lost:terminal-1",
  terminalId: null,
  summary: null,
  label: "Shell 1",
  error: "This terminal belonged to a previous host session.",
  requestState: "lost",
};

const tabsModel = (tabs: AgentStudioTerminalTab[]) => ({ tabs, mountedTabs: tabs });

const readyTab = (
  summary: TerminalSummary,
  lifecycle: TerminalSummary["lifecycle"] = summary.lifecycle,
): AgentStudioTerminalTab => ({
  tabId: `tab:${summary.terminalId}`,
  terminalId: summary.terminalId,
  summary: { ...summary, lifecycle },
  awaitingLifecycleSync: false,
  error: null,
  requestState: "ready",
});

const model: AgentStudioTerminalPanelModel = {
  scopeKey: "/repo:task-1",
  taskId: "task-1",
  ...tabsModel([lostTab]),
  activeTabId: "lost:terminal-1",
  isVisible: true,
  isLoading: false,
  isCreating: false,
  transportError: null,
  platform: "darwin",
  platformError: null,
  focusRequest: 0,
  controller: null,
  onToggle: () => undefined,
  onBackToChat: () => undefined,
  onSelectTab: () => undefined,
  onCreate: () => undefined,
  onRetryCreate: () => undefined,
  onReorderTab: () => undefined,
  onTitleChange: () => undefined,
  onClose: async () => ({ closed: true }),
  onLifecycle: () => undefined,
  onForgotten: () => undefined,
};

describe("AgentStudioTerminalPanel", () => {
  test("shows an explicit lost-session state", () => {
    render(<AgentStudioTerminalPanel model={model} />);
    expect(screen.getByText("This terminal belonged to a previous host session.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Shell 1, Lost after host restart" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry terminal creation" })).toBeNull();
  });

  test("shows transport-global protocol failures", () => {
    render(
      <AgentStudioTerminalPanel
        model={{ ...model, transportError: "Unsupported terminal protocol version." }}
      />,
    );
    expect(
      screen.getByText("Terminal transport failed: Unsupported terminal protocol version."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
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

  test("keeps inactive terminal viewports measurable while hiding them", () => {
    const secondTab: AgentStudioTerminalTab = {
      ...lostTab,
      tabId: "lost:terminal-2",
      label: "Shell 2",
    };
    const view = render(
      <AgentStudioTerminalPanel model={{ ...model, ...tabsModel([lostTab, secondTab]) }} />,
    );

    const panels = view.container.querySelectorAll<HTMLElement>('[data-slot="tabs-content"]');
    const inactivePanel = Array.from(panels).find((panel) => panel.dataset.state === "inactive");

    expect(panels).toHaveLength(2);
    expect(inactivePanel).toBeTruthy();
    expect(inactivePanel?.className).toContain("data-[state=inactive]:absolute");
    expect(inactivePanel?.className).toContain("data-[state=inactive]:invisible");
    expect(inactivePanel?.className).toContain("data-[state=inactive]:pointer-events-none");
    expect(inactivePanel?.className).not.toContain("data-[state=inactive]:hidden");
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
      label: "Shell 1",
      context: { repoPath: "/repo", taskId: "task-1" },
      initialWorkingDir: "/repo",
      createdAt: "2026-07-12T00:00:00.000Z",
      lifecycle: "running",
      exit: null,
    };
    render(
      <AgentStudioTerminalPanel
        model={{
          ...model,
          ...tabsModel([readyTab(summary)]),
          activeTabId: "tab:terminal-running",
          onClose,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close Shell 1" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(expect.anything(), false));
    expect(screen.queryByText("Terminate and close Shell 1?")).toBeNull();
  });

  test("uses a pointer cursor for clickable terminal tabs", () => {
    render(<AgentStudioTerminalPanel model={model} />);

    const tab = screen.getByRole("tab", { name: "Shell 1, Lost after host restart" });
    expect(tab.parentElement?.className).toContain("cursor-pointer");
  });

  test("activates terminal tabs through keyboard navigation", async () => {
    const onSelectTab = mock(() => undefined);
    const secondTab: AgentStudioTerminalTab = {
      ...lostTab,
      tabId: "lost:terminal-2",
      label: "Shell 2",
    };
    render(
      <AgentStudioTerminalPanel
        model={{
          ...model,
          ...tabsModel([lostTab, secondTab]),
          onSelectTab,
        }}
      />,
    );
    const firstTab = screen.getByRole("tab", { name: "Shell 1, Lost after host restart" });
    act(() => {
      firstTab.focus();
      fireEvent.keyDown(firstTab, { key: "ArrowRight" });
    });

    await waitFor(() => expect(onSelectTab).toHaveBeenCalledWith("lost:terminal-2"));
  });

  test("confirms only after the host reports a blocking command", async () => {
    const onClose = mock(async (_tab, confirmTerminate: boolean) =>
      confirmTerminate
        ? { closed: true as const }
        : { closed: false as const, confirmationRequired: true as const },
    );
    const summary: TerminalSummary = {
      terminalId: "terminal-busy",
      label: "Shell 1",
      context: { repoPath: "/repo", taskId: "task-1" },
      initialWorkingDir: "/repo",
      createdAt: "2026-07-12T00:00:00.000Z",
      lifecycle: "running",
      exit: null,
    };
    render(
      <AgentStudioTerminalPanel
        model={{
          ...model,
          ...tabsModel([readyTab(summary)]),
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
      label: "Shell 1",
      context: { repoPath: "/repo", taskId: "task-1" },
      initialWorkingDir: "/repo",
      createdAt: "2026-07-12T00:00:00.000Z",
      lifecycle: "running",
      exit: null,
    };
    render(
      <AgentStudioTerminalPanel
        model={{
          ...model,
          ...tabsModel([readyTab(summary, "closing")]),
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
      label: "Shell 1",
      context: { repoPath: "/repo", taskId: "task-1" },
      initialWorkingDir: "/repo/worktrees/task-1",
      createdAt: "2026-07-12T00:00:00.000Z",
      lifecycle: "running",
      exit: null,
    };
    const view = render(
      <div className="dark">
        <AgentStudioTerminalPanel
          model={{
            ...model,
            ...tabsModel([readyTab(summary)]),
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
    expect(tab.parentElement?.className).toContain("min-w-52");
    expect(tab.parentElement?.className).toContain("max-w-80");
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
          ...tabsModel([
            {
              tabId: "creating:terminal",
              terminalId: null,
              summary: null,
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
      label: "Shell 1",
      context: { repoPath: "/repo", taskId: "task-1" },
      initialWorkingDir: "/repo",
      createdAt: "2026-07-12T00:00:00.000Z",
      lifecycle: "running",
      exit: null,
    };
    render(
      <AgentStudioTerminalPanel
        model={{
          ...model,
          ...tabsModel([readyTab(summary, "exited")]),
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
