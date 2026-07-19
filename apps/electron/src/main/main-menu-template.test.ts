import { describe, expect, mock, test } from "bun:test";
import {
  createApplicationMenuTemplate,
  createContextMenuTemplate,
  createViewMenu,
} from "./main-menu-template";

const rolesFromSubmenu = (submenu: unknown): string[] => {
  if (!Array.isArray(submenu)) {
    throw new Error("submenu must be an array");
  }
  const roles: string[] = [];
  for (const item of submenu) {
    if (item && typeof item === "object" && "role" in item) {
      roles.push(String(item.role));
    }
  }
  return roles;
};

const submenuItems = (submenu: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(submenu)) {
    return [];
  }
  return submenu.filter((item): item is Record<string, unknown> => Boolean(item));
};

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
    if (!click) {
      throw new Error("Expected Check for Updates menu item click handler.");
    }
    (click as () => void)();
    expect(onCheckForUpdates).toHaveBeenCalled();
  });
});
