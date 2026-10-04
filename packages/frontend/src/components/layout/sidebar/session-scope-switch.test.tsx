import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { SessionScopeSwitch } from "./session-scope-switch";
import { alphaWorkspace } from "./session-navigation.test-support";

describe("SessionScopeSwitch", () => {
  test("switches between the current workspace and all workspaces in one action", () => {
    const onScopeChange = mock((_scope: "current" | "all") => {});
    render(
      <SessionScopeSwitch
        scope="current"
        onScopeChange={onScopeChange}
        workspace={alphaWorkspace}
      />,
    );

    const current = screen.getByRole("radio", { name: "Show sessions of openducktor" });
    const all = screen.getByRole("radio", { name: "Show sessions of all workspaces" });
    expect(current.getAttribute("aria-checked")).toBe("true");
    expect(all.getAttribute("aria-checked")).toBe("false");
    expect(current.textContent).toContain("openducktor");

    fireEvent.click(all);

    expect(onScopeChange).toHaveBeenCalledWith("all");
  });

  test("toggles the compact scope with one button and shows when all workspaces are selected", () => {
    const onScopeChange = mock((_scope: "current" | "all") => {});
    const { rerender } = render(
      <SessionScopeSwitch
        scope="current"
        onScopeChange={onScopeChange}
        workspace={alphaWorkspace}
        compact
      />,
    );

    const toggle = screen.getByRole("button", {
      name: "Show sessions of all workspaces",
      pressed: false,
    });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(toggle);
    expect(onScopeChange).toHaveBeenLastCalledWith("all");

    rerender(
      <SessionScopeSwitch
        scope="all"
        onScopeChange={onScopeChange}
        workspace={alphaWorkspace}
        compact
      />,
    );

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(onScopeChange).toHaveBeenLastCalledWith("current");
  });

  test("identifies a missing workspace and blocks the current-workspace choice", () => {
    render(<SessionScopeSwitch scope="current" onScopeChange={() => {}} workspace={null} />);

    expect(
      screen.getByRole("radio", { name: "No workspace is selected" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
