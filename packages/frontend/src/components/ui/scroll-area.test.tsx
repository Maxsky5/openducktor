import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { ScrollArea } from "./scroll-area";

// The viewport class overrides the table wrapper that Radix puts around the content. This test
// fails when Radix changes that wrapper, so the override can change with it.
test("the viewport wraps its content in the Radix table wrapper", () => {
  const view = render(
    <ScrollArea>
      <p>Content</p>
    </ScrollArea>,
  );
  const viewport = view.container.querySelector("[data-slot=scroll-area-viewport]");
  const wrapper = viewport?.firstElementChild;
  if (!(wrapper instanceof HTMLDivElement)) throw new Error("The viewport has no wrapper div.");
  expect(wrapper.style.display).toBe("table");
  expect(wrapper.firstElementChild?.textContent).toBe("Content");
});
