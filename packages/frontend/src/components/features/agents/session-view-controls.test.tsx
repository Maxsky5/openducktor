import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { SessionViewControls } from "./session-view-controls";

test("toggles the bottom panel and the right panel from the session top bar", () => {
  const onBottomToggle = mock(() => {});
  const onRightToggle = mock(() => {});
  const view = render(
    <SessionViewControls
      bottom={{ isAvailable: true, isOpen: false, onToggle: onBottomToggle }}
      right={{ isOpen: true, onToggle: onRightToggle }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show bottom panel" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));

  expect(onBottomToggle).toHaveBeenCalledTimes(1);
  expect(onRightToggle).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Hide right panel" }).getAttribute("aria-pressed"),
  ).toBe("true");

  view.rerender(
    <SessionViewControls
      bottom={{ isAvailable: false, isOpen: false, onToggle: onBottomToggle }}
      right={null}
    />,
  );

  expect(screen.getByRole("button", { name: "Show bottom panel" }).hasAttribute("disabled")).toBe(
    true,
  );
  expect(screen.queryByRole("button", { name: /right panel/ })).toBeNull();
});
