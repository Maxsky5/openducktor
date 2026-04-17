import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
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
  onReorderTab: () => {},
  agentStudioReady: true,
});

const createDragEvent = (
  type: string,
  dataTransfer: {
    effectAllowed: string;
    dropEffect: string;
    setData: () => void;
    getData: () => string;
  },
  extras: Record<string, number> = {},
): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: dataTransfer,
  });
  for (const [key, value] of Object.entries(extras)) {
    Object.defineProperty(event, key, {
      configurable: true,
      value,
    });
  }
  return event;
};

const setElementRect = (element: HTMLElement, rect: Omit<DOMRect, "toJSON">): void => {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      toJSON: () => ({}),
    }),
  });
};

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

  test("reports browser-style tab reorders from drag and drop", () => {
    const onReorderTab = mock(() => {});
    render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, {
          model: {
            ...buildModel(),
            onReorderTab,
          },
        }),
      ),
    );

    const firstTab = screen
      .getByRole("tab", { name: /Add social login/i })
      .closest("[data-task-tab-id]");
    const secondTab = screen
      .getByRole("tab", { name: /Ship QA checklist/i })
      .closest("[data-task-tab-id]");

    expect(firstTab).not.toBeNull();
    expect(secondTab).not.toBeNull();

    setElementRect(firstTab as HTMLElement, {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 40,
      width: 100,
      height: 40,
    });
    setElementRect(secondTab as HTMLElement, {
      x: 100,
      y: 0,
      left: 100,
      top: 0,
      right: 200,
      bottom: 40,
      width: 100,
      height: 40,
    });

    const dataTransfer = {
      effectAllowed: "all",
      dropEffect: "move",
      setData: () => {},
      getData: () => "task-2",
    };

    fireEvent(secondTab as HTMLElement, createDragEvent("dragstart", dataTransfer));
    fireEvent(firstTab as HTMLElement, createDragEvent("dragover", dataTransfer, { clientX: 10 }));
    fireEvent(firstTab as HTMLElement, createDragEvent("drop", dataTransfer, { clientX: 10 }));

    expect(onReorderTab).toHaveBeenCalledWith("task-2", "task-1", "before");
  });

  test("uses the actual drop target when release happens before a matching dragover state update", () => {
    const onReorderTab = mock(() => {});
    render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, {
          model: {
            ...buildModel(),
            onReorderTab,
          },
        }),
      ),
    );

    const firstTab = screen
      .getByRole("tab", { name: /Add social login/i })
      .closest("[data-task-tab-id]") as HTMLElement;
    const secondTab = screen
      .getByRole("tab", { name: /Ship QA checklist/i })
      .closest("[data-task-tab-id]") as HTMLElement;

    setElementRect(firstTab, {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 40,
      width: 100,
      height: 40,
    });
    setElementRect(secondTab, {
      x: 100,
      y: 0,
      left: 100,
      top: 0,
      right: 200,
      bottom: 40,
      width: 100,
      height: 40,
    });

    const dataTransfer = {
      effectAllowed: "all",
      dropEffect: "move",
      setData: () => {},
      getData: () => "task-1",
    };

    fireEvent(firstTab, createDragEvent("dragstart", dataTransfer));
    fireEvent(firstTab, createDragEvent("dragover", dataTransfer, { clientX: 10 }));
    fireEvent(secondTab, createDragEvent("drop", dataTransfer, { clientX: 190 }));

    expect(onReorderTab).toHaveBeenCalledWith("task-1", "task-2", "after");
  });

  test("auto-scrolls the overflowed strip when dragging near the edge", () => {
    const requestAnimationFrameCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      requestAnimationFrameCallbacks.push(callback);
      return requestAnimationFrameCallbacks.length;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => 0) as typeof globalThis.cancelAnimationFrame;

    try {
      render(
        createElement(
          Tabs,
          { value: "task-1" },
          createElement(AgentStudioTaskTabs, {
            model: {
              ...buildModel(),
              tabs: [
                { taskId: "task-1", taskTitle: "Tab 1", status: "working", isActive: true },
                { taskId: "task-2", taskTitle: "Tab 2", status: "idle", isActive: false },
                { taskId: "task-3", taskTitle: "Tab 3", status: "idle", isActive: false },
                { taskId: "task-4", taskTitle: "Tab 4", status: "idle", isActive: false },
                { taskId: "task-5", taskTitle: "Tab 5", status: "idle", isActive: false },
                { taskId: "task-6", taskTitle: "Tab 6", status: "idle", isActive: false },
              ],
            },
          }),
        ),
      );

      const tabList = screen.getByRole("tablist", { name: "Agent Studio task tabs" });
      const scrollRegion = tabList.parentElement?.parentElement as HTMLDivElement | null;
      const firstTab = screen.getByRole("tab", { name: /Tab 1/i }).closest("[data-task-tab-id]");
      const secondTab = screen.getByRole("tab", { name: /Tab 2/i }).closest("[data-task-tab-id]");

      expect(scrollRegion).not.toBeNull();
      expect(firstTab).not.toBeNull();
      expect(secondTab).not.toBeNull();

      setElementRect(scrollRegion as HTMLDivElement, {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 40,
        width: 200,
        height: 40,
      });
      setElementRect(secondTab as HTMLElement, {
        x: 90,
        y: 0,
        left: 90,
        top: 0,
        right: 180,
        bottom: 40,
        width: 90,
        height: 40,
      });
      (scrollRegion as HTMLDivElement).scrollLeft = 0;

      const dataTransfer = {
        effectAllowed: "all",
        dropEffect: "move",
        setData: () => {},
        getData: () => "task-1",
      };

      fireEvent(firstTab as HTMLElement, createDragEvent("dragstart", dataTransfer));
      fireEvent(
        secondTab as HTMLElement,
        createDragEvent("dragover", dataTransfer, { clientX: 196 }),
      );

      expect(requestAnimationFrameCallbacks.length).toBeGreaterThan(0);
      requestAnimationFrameCallbacks.shift()?.(0);

      expect((scrollRegion as HTMLDivElement).scrollLeft).toBeGreaterThan(0);
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  test("clears drag state when dragging ends without a drop", () => {
    render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, { model: buildModel() }),
      ),
    );

    const firstTab = screen
      .getByRole("tab", { name: /Add social login/i })
      .closest("[data-task-tab-id]") as HTMLElement;
    const secondTab = screen
      .getByRole("tab", { name: /Ship QA checklist/i })
      .closest("[data-task-tab-id]") as HTMLElement;

    setElementRect(secondTab, {
      x: 100,
      y: 0,
      left: 100,
      top: 0,
      right: 200,
      bottom: 40,
      width: 100,
      height: 40,
    });

    const dataTransfer = {
      effectAllowed: "all",
      dropEffect: "move",
      setData: () => {},
      getData: () => "task-1",
    };

    fireEvent(firstTab, createDragEvent("dragstart", dataTransfer));
    fireEvent(secondTab, createDragEvent("dragover", dataTransfer, { clientX: 110 }));

    expect(firstTab.getAttribute("data-dragging")).toBe("true");
    expect(secondTab.getAttribute("data-drop-position")).toBe("before");

    fireEvent(firstTab, createDragEvent("dragend", dataTransfer));

    expect(firstTab.getAttribute("data-dragging")).toBe("false");
    expect(secondTab.hasAttribute("data-drop-position")).toBeFalse();
  });

  test("does not start a reorder drag from the close button", () => {
    const onReorderTab = mock(() => {});
    render(
      createElement(
        Tabs,
        { value: "task-1" },
        createElement(AgentStudioTaskTabs, {
          model: {
            ...buildModel(),
            onReorderTab,
          },
        }),
      ),
    );

    const closeButton = screen.getByRole("button", { name: "Close tab for Ship QA checklist" });
    const secondTab = screen
      .getByRole("tab", { name: /Ship QA checklist/i })
      .closest("[data-task-tab-id]") as HTMLElement;

    const dataTransfer = {
      effectAllowed: "all",
      dropEffect: "move",
      setData: () => {},
      getData: () => "task-2",
    };

    fireEvent(closeButton, createDragEvent("dragstart", dataTransfer));

    expect(secondTab.getAttribute("data-dragging")).toBe("false");
    expect(onReorderTab).toHaveBeenCalledTimes(0);
  });
});
