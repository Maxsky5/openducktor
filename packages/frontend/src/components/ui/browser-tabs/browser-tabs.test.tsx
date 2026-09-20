import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Tabs } from "@/components/ui/tabs";
import { BrowserTabs, type BrowserTabItem } from "./browser-tabs";
import { BrowserTabsBar } from "./browser-tabs-bar";

function renderBrowserTabs() {
  const onSelect = mock(() => {});
  const onAction = mock(() => {});
  const onReorder = mock(() => {});
  const items: BrowserTabItem[] = [
    { value: "first", content: "First", triggerProps: { id: "first-trigger" } },
    {
      value: "second",
      content: "Second",
      action: (
        <button type="button" onClick={onAction}>
          Custom action
        </button>
      ),
    },
  ];
  const view = render(
    <Tabs value="first" onValueChange={onSelect}>
      <BrowserTabsBar>
        <BrowserTabs
          aria-label="Example tabs"
          items={items}
          selectedValue="first"
          onSelect={onSelect}
          onReorder={onReorder}
        />
      </BrowserTabsBar>
    </Tabs>,
  );
  return { ...view, onSelect, onAction, onReorder };
}

describe("BrowserTabs", () => {
  test("selects on mouse release and supports keyboard activation through Tabs", () => {
    const view = renderBrowserTabs();
    try {
      const second = view.getByRole("tab", { name: "Second" });
      fireEvent.mouseDown(second, { button: 0 });
      expect(view.onSelect).not.toHaveBeenCalled();
      fireEvent.mouseUp(second, { button: 0 });
      expect(view.onSelect).toHaveBeenCalledWith("second");
      view.onSelect.mockClear();
      fireEvent.keyDown(second, { key: "Enter" });
      expect(view.onSelect).toHaveBeenCalledWith("second");
    } finally {
      view.unmount();
    }
  });

  test("custom actions do not select tabs or start a drag", () => {
    const view = renderBrowserTabs();
    try {
      const action = view.getByRole("button", { name: "Custom action" });
      fireEvent.pointerDown(action, {
        button: 0,
        isPrimary: true,
        pointerId: 1,
        clientX: 10,
        clientY: 10,
      });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 10 });
      fireEvent.mouseDown(action, { button: 0 });
      fireEvent.mouseUp(action, { button: 0 });
      fireEvent.click(action);
      expect(view.onAction).toHaveBeenCalledTimes(1);
      expect(view.onSelect).not.toHaveBeenCalled();
      expect(view.onReorder).not.toHaveBeenCalled();
      expect(view.getAllByRole("tab", { hidden: true })).toHaveLength(2);
    } finally {
      view.unmount();
    }
  });

  test("dragging uses an inert preview and suppresses selection on release", async () => {
    const view = renderBrowserTabs();
    try {
      const first = view.getByRole("tab", { name: "First" });
      fireEvent.pointerDown(first, {
        button: 0,
        isPrimary: true,
        pointerId: 1,
        clientX: 10,
        clientY: 10,
      });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 10 });
      await waitFor(() => expect(view.getAllByRole("tab", { hidden: true })).toHaveLength(3));
      expect(view.container.querySelectorAll("#first-trigger")).toHaveLength(1);
      const preview = view
        .getAllByRole("tab", { hidden: true })
        .find((tab) => tab.closest("[inert]"));
      expect(preview?.textContent).toBe("First");
      fireEvent.pointerUp(document, { pointerId: 1 });
      fireEvent.mouseUp(first, { button: 0 });
      expect(view.onSelect).not.toHaveBeenCalled();
    } finally {
      fireEvent.pointerCancel(document, { pointerId: 1 });
      view.unmount();
      // dnd-kit retains its document click blocker for 50 ms after a drag ends.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
  });
});
