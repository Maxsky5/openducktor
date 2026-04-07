import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
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
  ],
  availableTabTasks: [buildTask({ id: "task-3", title: "Stabilize desktop startup" })],
  isLoadingAvailableTabTasks: false,
  onCreateTab: () => {},
  onCloseTab: () => {},
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
    expect(html).toContain('aria-label="Working"');
    expect(html).toContain('aria-label="Waiting input"');
    expect(html).toContain("text-warning-accent");
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
            kind: "documents",
            isOpen: true,
            onToggle: () => {},
          },
        }),
      ),
    );

    expect(html).toContain("Hide documents panel");

    const { unmount } = render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, {
          model: buildModel(),
          rightPanelToggleModel: {
            kind: "documents",
            isOpen: true,
            onToggle: () => {},
          },
        }),
      ),
    );

    const newTabButton = screen.getByRole("button", { name: "Open new task tab" });
    const rightPanelToggle = screen.getByRole("button", { name: "Hide documents panel" });

    expect(
      newTabButton.compareDocumentPosition(rightPanelToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    unmount();
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

  test("keeps the new-tab button outside the horizontal scroll region", () => {
    render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, {
          model: buildModel(),
          rightPanelToggleModel: {
            kind: "documents",
            isOpen: true,
            onToggle: () => {},
          },
        }),
      ),
    );

    const tabList = screen.getByRole("tablist", { name: "Agent Studio task tabs" });
    const scrollRegion = tabList.parentElement?.parentElement;
    const newTabButton = screen.getByRole("button", { name: "Open new task tab" });
    const rightPanelToggle = screen.getByRole("button", { name: "Hide documents panel" });

    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion?.contains(newTabButton)).toBeFalse();
    expect(
      newTabButton.compareDocumentPosition(rightPanelToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
