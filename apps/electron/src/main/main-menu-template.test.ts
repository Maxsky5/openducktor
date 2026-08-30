import { describe, expect, mock, test } from "bun:test";
import {
  createApplicationMenuTemplate,
  createContextMenuTemplate,
  createViewMenu,
} from "./main-menu-template";
import type { MenuItemConstructorOptions } from "electron";

type MenuSubmenu = MenuItemConstructorOptions["submenu"] | undefined;

const submenuItems = (submenu: MenuSubmenu): MenuItemConstructorOptions[] =>
  Array.isArray(submenu) ? submenu : [];

const rolesFromSubmenu = (submenu: MenuSubmenu): string[] =>
  submenuItems(submenu).flatMap((item) => (item.role ? [item.role] : []));

const isZeroArgumentClickHandler = (click: Function): click is () => void => click.length === 0;

describe("main menu template", () => {
  test("adds devtools but not reload roles to the dev View menu", () => {
    const viewMenu = createViewMenu(true);
    const roles = rolesFromSubmenu(viewMenu.submenu);

    expect(roles).toContain("toggleDevTools");
    expect(roles).not.toContain("reload");
    expect(roles).not.toContain("forceReload");
  });

  test("hides devtools outside dev mode", () => {
    const viewMenu = createViewMenu(false);
    const roles = rolesFromSubmenu(viewMenu.submenu);

    expect(roles).not.toContain("toggleDevTools");
  });

  test("adds reload and devtools roles to the dev context menu", () => {
    const roles = createContextMenuTemplate(true).map((item) =>
      "role" in item ? item.role : null,
    );

    expect(roles).toEqual(expect.arrayContaining(["reload", "forceReload", "toggleDevTools"]));
  });

  test("puts reload roles in the main application menu", () => {
    const template = createApplicationMenuTemplate({
      isDevelopment: true,
      appName: "OpenDucktor",
    });
    const mainMenu = template.find((item) => item.label === "OpenDucktor");
    const roles = rolesFromSubmenu(mainMenu?.submenu);

    expect(roles).toEqual(expect.arrayContaining(["reload", "forceReload"]));
    expect(template.some((item) => item.label === "View")).toBe(true);
  });

  test("adds Check for Updates and invokes the provided callback", () => {
    const onCheckForUpdates = mock(() => {});
    const template = createApplicationMenuTemplate({
      isDevelopment: false,
      appName: "OpenDucktor",
      onCheckForUpdates,
    });
    const updateItem = template
      .flatMap((item) => submenuItems(item.submenu))
      .find((item) => item.label === "Check for Updates...");

    expect(updateItem).toMatchObject({
      label: "Check for Updates...",
      enabled: true,
    });

    const click = updateItem?.click;
    if (!click || !isZeroArgumentClickHandler(click)) {
      throw new Error("Expected a zero-argument Check for Updates menu item click handler.");
    }
    click();
    expect(onCheckForUpdates).toHaveBeenCalled();
  });
});
