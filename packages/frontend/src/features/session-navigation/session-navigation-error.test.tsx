import { expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { SessionNavigationError } from "./session-navigation-error";

test("explains the failure before offering technical details and a retry", () => {
  const retry = mock(() => {});
  const props = {
    scopeLabel: "Workspace sessions",
    repositoryPath: "/repo",
    error: new Error("Storage access denied"),
    operation: "load" as const,
    onRetry: retry,
  };
  const view = render(<SessionNavigationError {...props} />);
  try {
    expect(view.getByRole("alert").getAttribute("aria-labelledby")).toBe(
      view.getByRole("heading", { name: "Couldn't open your conversation" }).id,
    );
    expect(view.queryByText("Storage access denied")).toBeNull();
    const details = view.getByRole("button", { name: "Error details" });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(details);
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByText("Storage access denied")).toBeTruthy();
    expect(view.getByText("/repo")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(<SessionNavigationError {...props} operation="save" isPending />);
    expect(view.getByRole("heading", { name: "Couldn't save your selection" })).toBeTruthy();
    const pending = view.getByRole("button", { name: "Trying again…" });
    expect(pending.hasAttribute("disabled")).toBe(true);
    fireEvent.click(pending);
    expect(retry).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
  }
});
