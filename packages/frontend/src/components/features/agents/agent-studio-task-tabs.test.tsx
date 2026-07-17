import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Tabs } from "@/components/ui/tabs";
import { buildTask } from "./agent-chat/agent-chat-test-fixtures";
import { AgentStudioTaskTabs } from "./agent-studio-task-tabs";

const buildModel = () => ({
  tabs: [
    {
      taskId: "task-1",
      taskTitle: "Add social login",
      status: "working" as const,
      isActive: true,
    },
    {
      taskId: "task-2",
      taskTitle: "Ship QA checklist",
      status: "waiting_input" as const,
      isActive: false,
    },
    {
      taskId: "task-3",
      taskTitle: "Document CLI",
      status: "idle" as const,
      isActive: false,
    },
  ],
  availableTabTasks: [buildTask({ id: "task-4", title: "Stabilize desktop startup" })],
  isLoadingAvailableTabTasks: false,
  onSelectTab: () => {},
  onCreateTab: () => {},
  onCloseTab: () => {},
  onReorderTab: () => {},
  agentStudioReady: true,
});

describe("AgentStudioTaskTabs", () => {
  test("renders browser-style tabs and status icons", () => {
    const html = renderToStaticMarkup(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, { model: buildModel() }),
      ),
    );

    expect(html).toContain("Add social login");
    expect(html).toContain("Ship QA checklist");
    expect(html).toContain("Document CLI");
    expect(html).toContain('title="Working"');
    expect(html).toContain('title="Waiting input"');
    expect(html).toContain('title="Idle"');
    expect(html).toContain(">Working</span>");
    expect(html).toContain(">Waiting input</span>");
    expect(html).toContain(">Idle</span>");
    expect(html).toContain("agent-studio-task-status-running-dot");
    expect(html).toContain("fill-status-running");
    expect(html).toContain("fill-input");
    expect(html).toContain("text-warning-accent");
    expect(html).not.toContain("animate-spin text-status-running");
    expect(html).toContain('aria-label="Open new task tab"');
    expect(html).toContain("Close tab for Add social login");
    expect(html).toContain("bg-secondary");
    expect(html).not.toContain("bg-gradient-to-b");
    expect(html).toContain("border-b-transparent");
    expect(html).toContain("after:bg-card");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("hide-scrollbar");
    expect(html).toContain("max-w-full");
    expect(html).not.toContain("overflow-y-visible");
    expect(html).not.toContain("rounded-full border");
    expect(html).not.toContain("bg-card/80");
    expect(html).toContain("bg-studio-chrome");
    expect(html).toContain("size-[1.4rem]");
    expect(html).toContain("cursor-pointer");
    expect(html).not.toContain("cursor-grab");
    expect(html).not.toContain("cursor-inherit");

    const { unmount } = render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, { model: buildModel() }),
      ),
    );

    const newTabButton = screen.getByRole("button", { name: "Open new task tab" });
    const lastTabCloseButton = screen.getByRole("button", {
      name: "Close tab for Ship QA checklist",
    });

    expect(
      lastTabCloseButton.compareDocumentPosition(newTabButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    unmount();
  });

  test("shows empty-state copy when no tabs are open", () => {
    const html = renderToStaticMarkup(
      createElement(
        Tabs,
        { value: "__empty__" },
        createElement(AgentStudioTaskTabs, {
          model: {
            ...buildModel(),
            tabs: [],
            availableTabTasks: [],
          },
        }),
      ),
    );

    expect(html).toContain("Open a task tab to start working with an agent.");
    expect(html).toContain('aria-label="Open new task tab"');
  });

  test("renders right panel toggle when provided", () => {
    const html = renderToStaticMarkup(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, {
          model: buildModel(),
          rightPanelToggleModel: {
            kind: "task_execution",
            isOpen: true,
            onToggle: () => {},
          },
        }),
      ),
    );

    expect(html).toContain("Hide task execution panel");

    const { unmount } = render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, {
          model: buildModel(),
          rightPanelToggleModel: {
            kind: "task_execution",
            isOpen: true,
            onToggle: () => {},
          },
        }),
      ),
    );

    const newTabButton = screen.getByRole("button", { name: "Open new task tab" });
    const rightPanelToggle = screen.getByRole("button", { name: "Hide task execution panel" });

    expect(
      newTabButton.compareDocumentPosition(rightPanelToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    unmount();
  });

  test("renders the terminal toggle as an icon-only action", () => {
    render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, {
          model: buildModel(),
          terminalPanelToggleModel: {
            isVisible: true,
            disabled: false,
            onToggle: () => {},
          },
        }),
      ),
    );

    const terminalToggle = screen.getByRole("button", { name: "Hide terminals" });
    expect(terminalToggle.textContent).toBe("");
    expect(screen.queryByRole("status", { name: "3 running terminals" })).toBeNull();
  });

  test("uses the execution panel hover treatment for the terminal toggle", () => {
    render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, {
          model: buildModel(),
          terminalPanelToggleModel: {
            isVisible: false,
            disabled: false,
            onToggle: () => {},
          },
          rightPanelToggleModel: {
            kind: "task_execution",
            isOpen: false,
            onToggle: () => {},
          },
        }),
      ),
    );

    const terminalToggle = screen.getByRole("button", { name: "Show terminals" });
    const executionToggle = screen.getByRole("button", { name: "Show task execution panel" });
    for (const className of [
      "border-transparent",
      "hover:border-studio-chrome-foreground/30",
      "hover:bg-studio-chrome-foreground/10",
    ]) {
      expect(terminalToggle.className).toContain(className);
      expect(executionToggle.className).toContain(className);
    }
  });

  test("keeps new-tab button enabled while tab tasks are loading", () => {
    const html = renderToStaticMarkup(
      createElement(
        Tabs,
        { value: "__empty__" },
        createElement(AgentStudioTaskTabs, {
          model: {
            ...buildModel(),
            tabs: [],
            availableTabTasks: [],
            isLoadingAvailableTabTasks: true,
          },
        }),
      ),
    );

    expect(html).toMatch(/aria-label="Open new task tab"/);
    expect(html).not.toMatch(/aria-label="Open new task tab"[^>]*disabled/);
  });

  test("shows loaded tasks immediately when opening the new-tab dialog", async () => {
    render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, { model: buildModel() }),
      ),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open new task tab" }));
    });

    expect(screen.queryByText("Loading tasks…")).toBeNull();
    expect(screen.getByRole("button", { name: /Stabilize desktop startup/i })).toBeTruthy();
  });

  test("keeps the new-tab button outside the horizontal scroll region", () => {
    render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, {
          model: buildModel(),
          rightPanelToggleModel: {
            kind: "task_execution",
            isOpen: true,
            onToggle: () => {},
          },
        }),
      ),
    );

    const tabList = screen.getByRole("tablist", { name: "Agent Studio task tabs" });
    const scrollRegion = tabList.parentElement?.parentElement;
    const newTabButton = screen.getByRole("button", { name: "Open new task tab" });
    const rightPanelToggle = screen.getByRole("button", { name: "Hide task execution panel" });

    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion?.contains(newTabButton)).toBeFalse();
    expect(
      newTabButton.compareDocumentPosition(rightPanelToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("clicking an inactive tab still selects it", async () => {
    const onSelectTab = mock(() => {});

    render(
      createElement(
        Tabs,
        { value: "task-1", onValueChange: onSelectTab },
        createElement(AgentStudioTaskTabs, {
          model: {
            ...buildModel(),
            onSelectTab,
          },
        }),
      ),
    );

    const inactiveTab = screen.getByRole("tab", { name: /Ship QA checklist/i });

    await act(async () => {
      fireEvent.mouseDown(inactiveTab, { button: 0, buttons: 1 });
      fireEvent.mouseUp(inactiveTab, { button: 0 });
      fireEvent.click(inactiveTab, { button: 0 });
    });

    expect(onSelectTab).toHaveBeenCalledWith("task-2");
  });
});
