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

  test("keeps both scope choices and identifies the current workspace in compact mode", () => {
    render(
      <SessionScopeSwitch
        scope="all"
        onScopeChange={() => {}}
        workspace={alphaWorkspace}
        compact
      />,
    );

    const current = screen.getByRole("radio", { name: "Show sessions of openducktor" });
    expect(current.title).toBe("Show sessions of openducktor");
    expect(
      screen
        .getByRole("radio", { name: "Show sessions of all workspaces" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("identifies a missing workspace and blocks the current-workspace choice", () => {
    render(<SessionScopeSwitch scope="current" onScopeChange={() => {}} workspace={null} />);

    expect(
      screen.getByRole("radio", { name: "No workspace is selected" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
