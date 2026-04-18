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
  ],
  availableTabTasks: [buildTask({ id: "task-3", title: "Stabilize desktop startup" })],
  isLoadingAvailableTabTasks: false,
  onSelectTab: () => {},
  onCreateTab: () => {},
  onCloseTab: () => {},
  onReorderTab: () => {},
  agentStudioReady: true,
});

const setElementRect = (element: HTMLElement, rect: Omit<DOMRect, "toJSON">): void => {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      toJSON: () => ({}),
    }),
  });
};

const dragWithMouse = async (
  element: HTMLElement,
  start: { clientX: number; clientY: number },
  moves: Array<{ clientX: number; clientY: number }>,
): Promise<void> => {
  await act(async () => {
    fireEvent.mouseDown(element, {
      button: 0,
      buttons: 1,
      ...start,
    });

    for (const move of moves) {
      fireEvent.mouseMove(document, {
        buttons: 1,
        ...move,
      });
    }
  });
};

const finishMouseDrag = async (position: { clientX: number; clientY: number }): Promise<void> => {
  await act(async () => {
    fireEvent.mouseUp(document, {
      button: 0,
      ...position,
    });
  });
};

const setDefaultTabRects = (firstTab: HTMLElement, secondTab: HTMLElement): void => {
  setElementRect(firstTab, {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 120,
    bottom: 40,
    width: 120,
    height: 40,
  });
  setElementRect(secondTab, {
    x: 130,
    y: 0,
    left: 130,
    top: 0,
    right: 260,
    bottom: 40,
    width: 130,
    height: 40,
  });
};

const withMouseSensorFallback = async (run: () => Promise<void>): Promise<void> => {
  const originalPointerEvent = globalThis.PointerEvent;
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value: undefined,
  });

  try {
    await run();
  } finally {
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      value: originalPointerEvent,
    });
  }
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

  test("reorders tabs with pointer dragging", async () => {
    const onReorderTab = mock(() => {});
    await withMouseSensorFallback(async () => {
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

      setDefaultTabRects(firstTab as HTMLElement, secondTab as HTMLElement);

      await dragWithMouse(secondTab as HTMLElement, { clientX: 170, clientY: 20 }, [
        { clientX: 150, clientY: 20 },
        { clientX: 50, clientY: 20 },
      ]);
      await finishMouseDrag({ clientX: 50, clientY: 20 });

      expect(onReorderTab).toHaveBeenCalledWith("task-2", "task-1", "before");
    });
  });

  test("shows a dragged tab preview instead of only moving the source node", async () => {
    await withMouseSensorFallback(async () => {
      render(
        createElement(
          Tabs,
          { value: "task-1" },
          createElement(AgentStudioTaskTabs, {
            model: {
              ...buildModel(),
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

      setDefaultTabRects(firstTab, secondTab);

      await dragWithMouse(firstTab, { clientX: 40, clientY: 20 }, [{ clientX: 60, clientY: 20 }]);

      expect(firstTab.getAttribute("data-dragging")).toBe("true");
      expect(screen.getAllByText("Add social login").length).toBeGreaterThan(1);

      await finishMouseDrag({ clientX: 60, clientY: 20 });
    });
  });

  test("clears drag state when dragging ends without a drop", async () => {
    const onReorderTab = mock(() => {});
    await withMouseSensorFallback(async () => {
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

      setDefaultTabRects(firstTab, secondTab);

      await dragWithMouse(firstTab, { clientX: 40, clientY: 20 }, [{ clientX: 55, clientY: 20 }]);
      expect(firstTab.getAttribute("data-dragging")).toBe("true");

      await finishMouseDrag({ clientX: 55, clientY: 20 });

      expect(firstTab.getAttribute("data-dragging")).toBe("false");
      expect(onReorderTab).toHaveBeenCalledTimes(0);
    });
  });

  test("dragging an inactive tab does not trigger selection side effects", async () => {
    const onSelectTab = mock(() => {});
    const onReorderTab = mock(() => {});

    await withMouseSensorFallback(async () => {
      render(
        createElement(
          Tabs,
          { value: "task-1", onValueChange: onSelectTab },
          createElement(AgentStudioTaskTabs, {
            model: {
              ...buildModel(),
              onSelectTab,
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

      setDefaultTabRects(firstTab, secondTab);

      await dragWithMouse(secondTab, { clientX: 170, clientY: 20 }, [
        { clientX: 150, clientY: 20 },
        { clientX: 50, clientY: 20 },
      ]);
      await finishMouseDrag({ clientX: 50, clientY: 20 });

      expect(onSelectTab).toHaveBeenCalledTimes(0);
      expect(onReorderTab).toHaveBeenCalledWith("task-2", "task-1", "before");
    });
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

  test("does not start a reorder drag from the close button", async () => {
    const onReorderTab = mock(() => {});

    await withMouseSensorFallback(async () => {
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

      setElementRect(secondTab, {
        x: 130,
        y: 0,
        left: 130,
        top: 0,
        right: 260,
        bottom: 40,
        width: 130,
        height: 40,
      });

      await act(async () => {
        fireEvent.mouseDown(closeButton, {
          button: 0,
          buttons: 1,
          clientX: 200,
          clientY: 20,
        });
        fireEvent.mouseMove(document, {
          buttons: 1,
          clientX: 240,
          clientY: 20,
        });
      });
      await finishMouseDrag({ clientX: 240, clientY: 20 });

      expect(secondTab.getAttribute("data-dragging")).toBe("false");
      expect(onReorderTab).toHaveBeenCalledTimes(0);
    });
  });
});
