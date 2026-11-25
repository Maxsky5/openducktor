import { expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { CssPresenceList, useCssPresence } from "./css-presence";

test("initial mount renders children once while still animating later additions", () => {
  let initialItemRenders = 0;
  function Item({ label, countMount = false }: { label: string; countMount?: boolean }) {
    if (countMount) initialItemRenders += 1;
    const { presenceProps } = useCssPresence();
    return <li {...presenceProps}>{label}</li>;
  }
  const initialItem = <Item key="a" label="A" countMount />;
  const list = (items: ReactElement[]) => (
    <ul aria-label="Items">
      <CssPresenceList>{items}</CssPresenceList>
    </ul>
  );
  const view = render(list([initialItem]));
  try {
    expect(initialItemRenders).toBe(1);
    expect(view.getByText("A").getAttribute("data-animate-entry")).toBe("false");

    view.rerender(list([initialItem, <Item key="b" label="B" />]));
    expect(initialItemRenders).toBe(1);
    expect(view.getByText("B").getAttribute("data-animate-entry")).toBe("true");
  } finally {
    view.unmount();
  }
});

test("a list render does not render a child that keeps its element", () => {
  let renders = 0;
  function Item() {
    renders += 1;
    const { presenceProps } = useCssPresence();
    return <li {...presenceProps}>Item</li>;
  }
  const item = <Item key="item" />;
  const list = (label: string) => (
    <ul aria-label={label}>
      <CssPresenceList>{[item]}</CssPresenceList>
    </ul>
  );
  const view = render(list("First"));
  try {
    const before = renders;
    view.rerender(list("Second"));
    expect(view.getByRole("list", { name: "Second" }).textContent).toBe("Item");
    expect(renders - before).toBe(0);
  } finally {
    view.unmount();
  }
});

test("an instant list adds a child without entry motion and removes it at once", async () => {
  function Item({ label }: { label: string }) {
    const { presenceProps } = useCssPresence();
    return <li {...presenceProps}>{label}</li>;
  }
  const list = (items: ReactElement[]) => (
    <ul aria-label="Results">
      <CssPresenceList instant>{items}</CssPresenceList>
    </ul>
  );
  const view = render(list([<Item key="a" label="A" />]));
  try {
    view.rerender(list([<Item key="a" label="A" />, <Item key="b" label="B" />]));
    expect(view.getByText("B").getAttribute("data-animate-entry")).toBe("false");
    view.rerender(list([<Item key="b" label="B" />]));
    // CSS hides the leaving child in this commit, and presence removes it right after.
    expect(view.getByText("A").getAttribute("data-presence-instant")).toBe("true");
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.queryByText("A")).toBeNull();
  } finally {
    view.unmount();
  }
});

test("a list inside an instant list is instant too", async () => {
  function Item({ label }: { label: string }) {
    const { presenceProps } = useCssPresence();
    return <li {...presenceProps}>{label}</li>;
  }
  function Inner({ items }: { items: ReactElement[] }) {
    const { presenceProps } = useCssPresence();
    return (
      <li {...presenceProps}>
        <ul>
          <CssPresenceList>{items}</CssPresenceList>
        </ul>
      </li>
    );
  }
  const tree = (items: ReactElement[]) => (
    <ul>
      <CssPresenceList instant>{[<Inner key="inner" items={items} />]}</CssPresenceList>
    </ul>
  );
  const view = render(tree([<Item key="a" label="A" />]));
  try {
    view.rerender(tree([]));
    expect(view.getByText("A").getAttribute("data-presence-instant")).toBe("true");
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.queryByText("A")).toBeNull();
  } finally {
    view.unmount();
  }
});
