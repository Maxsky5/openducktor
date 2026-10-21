import { describe, expect, mock, test } from "bun:test";
import {
  createApplicationMenuTemplate,
  createViewMenu,
  type MainMenuInput,
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

  test("reloads the focused window page from the main menu, never a focused webview", () => {
    const onReloadWindow = mock<MainMenuInput["onReloadWindow"]>(() => {});
    const template = createApplicationMenuTemplate({
      isDevelopment: true,
      appName: "OpenDucktor",
      onReloadWindow,
    });
    const items = submenuItems(template.find((item) => item.label === "OpenDucktor")?.submenu);
    const window = { id: 1 };

    expect(rolesFromSubmenu(items)).not.toContain("reload");
    expect(rolesFromSubmenu(items)).not.toContain("forceReload");
    for (const [label, accelerator] of [
      ["Reload", "CmdOrCtrl+R"],
      ["Force Reload", "Shift+CmdOrCtrl+R"],
    ]) {
      const item = items.find((candidate) => candidate.label === label);
      expect(item?.accelerator).toBe(accelerator);
      // SAFETY: the click handler passes the window through to `onReloadWindow` only.
      item?.click?.(item as never, window as never, {} as never);
    }
    expect(onReloadWindow.mock.calls).toEqual([
      [window, false],
      [window, true],
    ]);
    expect(template.some((item) => item.label === "View")).toBe(true);
  });

  test("adds Check for Updates and invokes the provided callback", () => {
    const onCheckForUpdates = mock(() => {});
    const template = createApplicationMenuTemplate({
      isDevelopment: false,
      appName: "OpenDucktor",
      onCheckForUpdates,
      onReloadWindow: () => {},
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
