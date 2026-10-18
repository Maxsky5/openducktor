import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactElement } from "react";
import { ToolbarSearchField, SearchField } from "./search-field";

afterEach(() => {
  cleanup();
});

const renderInParent = (field: ReactElement) => {
  const onParentKeyDown = mock(() => {});
  render(<div onKeyDown={onParentKeyDown}>{field}</div>);
  return { onParentKeyDown, input: screen.getByRole("textbox", { name: "Search" }) };
};

describe("SearchField", () => {
  test("lets Escape reach the parent and keeps the text", () => {
    const onValueChange = mock((_value: string) => {});
    const { onParentKeyDown, input } = renderInParent(
      <SearchField
        id="search"
        label="Search"
        value="main"
        placeholder="Search"
        onValueChange={onValueChange}
      />,
    );

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onValueChange).not.toHaveBeenCalled();
    expect(onParentKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe("ToolbarSearchField", () => {
  test("names the field with a label that only screen readers show", () => {
    renderInParent(
      <ToolbarSearchField
        id="search"
        label="Search"
        value=""
        placeholder="Search"
        onValueChange={() => {}}
      />,
    );

    expect(screen.getByText("Search").className).toContain("sr-only");
  });

  test("clears the text with Escape and stops the event", () => {
    const onValueChange = mock((_value: string) => {});
    const { onParentKeyDown, input } = renderInParent(
      <ToolbarSearchField
        id="search"
        label="Search"
        value="main"
        placeholder="Search"
        onValueChange={onValueChange}
      />,
    );

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onValueChange).toHaveBeenCalledWith("");
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  test("gives its input through the ref, so a shortcut can focus it", () => {
    const ref = createRef<HTMLInputElement>();
    const { input } = renderInParent(
      <ToolbarSearchField
        ref={ref}
        id="search"
        label="Search"
        value=""
        placeholder="Search"
        onValueChange={() => {}}
      />,
    );

    if (!(input instanceof HTMLInputElement)) throw new Error("Expected the search input.");
    expect(ref.current).toBe(input);
  });
});
