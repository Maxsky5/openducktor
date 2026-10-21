import { describe, expect, mock, test } from "bun:test";
import type { BrowserPermissionKind } from "@openducktor/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BrowserSiteMenu, type BrowserSiteMenuProps } from "./browser-site-menu";

const renderMenu = (overrides: Partial<BrowserSiteMenuProps> = {}) => {
  const onReset = mock((_permission: BrowserPermissionKind | null) => {});
  render(
    <BrowserSiteMenu
      origin="http://localhost:3000"
      permissions={[
        { permission: "camera", decision: "granted" },
        { permission: "notifications", decision: "denied" },
      ]}
      loading={false}
      error={null}
      onReset={onReset}
      {...overrides}
    />,
  );
  return { onReset };
};

describe("BrowserSiteMenu", () => {
  test("lists the saved choices of the current site and resets one or all", () => {
    const { onReset } = renderMenu();

    expect(screen.getByText("http://localhost:3000")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Saved choices" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["CameraAllowedReset", "NotificationsDeniedReset"]);

    fireEvent.click(screen.getByRole("button", { name: "Reset Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));

    expect(onReset).toHaveBeenNthCalledWith(1, "notifications");
    expect(onReset).toHaveBeenNthCalledWith(2, null);
  });

  test("disables the reset actions while a reset runs", () => {
    renderMenu({ loading: true });

    for (const button of screen.getAllByRole("button")) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });

  test("shows the loading, empty, error, and no-site states", () => {
    const { unmount } = render(
      <BrowserSiteMenu
        origin="http://localhost:3000"
        permissions={null}
        loading
        error={null}
        onReset={() => {}}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Loading saved choices...");
    unmount();

    const empty = render(
      <BrowserSiteMenu
        origin="http://localhost:3000"
        permissions={[]}
        loading={false}
        error={null}
        onReset={() => {}}
      />,
    );
    expect(screen.getByText(/No saved choices/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    empty.unmount();

    const failed = render(
      <BrowserSiteMenu
        origin="http://localhost:3000"
        permissions={null}
        loading={false}
        error="The host cannot read site settings."
        onReset={() => {}}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("The host cannot read site settings.");
    failed.unmount();

    render(
      <BrowserSiteMenu
        origin={null}
        permissions={null}
        loading={false}
        error={null}
        onReset={() => {}}
      />,
    );
    expect(screen.getByText("This page has no site settings.")).toBeTruthy();
  });
});
