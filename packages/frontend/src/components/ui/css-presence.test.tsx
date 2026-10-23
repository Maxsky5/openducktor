import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { CssPresenceList, useCssPresence } from "./css-presence";

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
