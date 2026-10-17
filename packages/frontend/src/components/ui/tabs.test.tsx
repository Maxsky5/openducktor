import { describe, expect, spyOn, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

const renderTabs = () =>
  render(
    <Tabs defaultValue="one">
      <TabsList>
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
    </Tabs>,
  );

describe("TabsTrigger", () => {
  test("focuses a clicked tab without the keyboard focus ring", () => {
    const view = renderTabs();
    const tab = view.getByRole("tab", { name: "Two" });
    const focus = spyOn(tab, "focus");

    fireEvent.mouseDown(tab, { button: 0 });

    expect(focus.mock.calls[0]).toEqual([{ focusVisible: false }]);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    view.unmount();
  });

  test("leaves a Ctrl+click to the context menu", () => {
    const view = renderTabs();
    const tab = view.getByRole("tab", { name: "Two" });
    const focus = spyOn(tab, "focus");

    fireEvent.mouseDown(tab, { button: 0, ctrlKey: true });

    expect(focus).not.toHaveBeenCalled();
    expect(tab.getAttribute("aria-selected")).toBe("false");
    view.unmount();
  });
});
